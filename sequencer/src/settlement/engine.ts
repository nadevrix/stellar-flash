/**
 * Motor de settlement: el "puente" entre el secuenciador (L2) y Stellar (L1).
 *
 * En cada `tick`:
 *  1. Sondea la salud de la L1.
 *  2. Si la L1 responde, escanea depósitos nuevos del contrato y los acredita en L2.
 *  3. Sella un lote si hay txs pendientes y toca (por tiempo o por tamaño).
 *  4. Toma el lote sellado más antiguo (los commits son estrictamente secuenciales) y aplica la
 *     política: COMMIT (publica), DEFER (espera un poco), HOLD (L1 caída).
 *  5. Marca como finalizados los lotes cuyo periodo de desafío ya pasó.
 *
 * Todo error de L1 se registra en el lote (attempts/lastError) y se reintenta con backoff.
 * La L2 nunca se detiene por culpa de la L1.
 */
import type { Sequencer } from '../core/sequencer.ts';
import type { Store } from '../db/store.ts';
import { L1HealthMonitor, type HealthSnapshot } from './health.ts';
import { L1Error, type L1Client } from './l1.ts';
import { decideSettlement, type PolicyConfig, type SettlementDecision } from './policy.ts';

export interface EngineConfig extends PolicyConfig {
  sealIntervalMs: number;
  challengePeriodLedgers: number;
  depositScanStartLedger: number;
  depositBatchLimit?: number;
}

export interface EngineEvent {
  at: number;
  kind: 'health' | 'seal' | 'commit' | 'commit_failed' | 'defer' | 'hold' | 'finalized' | 'deposit' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export type Logger = (ev: EngineEvent) => void;

const META_DEPOSIT_LEDGER = 'deposit_scan_ledger';

export class SettlementEngine {
  readonly monitor: L1HealthMonitor;
  private readonly seqr: Sequencer;
  private readonly store: Store;
  private readonly l1: L1Client;
  private readonly cfg: EngineConfig;
  private readonly log: Logger;
  private lastSealAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastDecision: SettlementDecision | null = null;
  private lastDecisionReason = '';

  constructor(seqr: Sequencer, l1: L1Client, monitor: L1HealthMonitor, cfg: EngineConfig, log: Logger = () => {}) {
    this.seqr = seqr;
    this.store = seqr.store;
    this.l1 = l1;
    this.monitor = monitor;
    this.cfg = cfg;
    this.log = log;
    this.monitor.onChange((h, prev) => {
      this.store.logHealth({ at: h.at, status: h.status, latestLedger: h.latestLedger, ledgerAgeSec: h.ledgerAgeSec, feeP50: h.feeP50, feeP90: h.feeP90, okEndpoints: h.okEndpoints, totalEndpoints: h.totalEndpoints, reason: h.reason });
      this.log({ at: h.at, kind: 'health', message: `L1 ${prev.status} → ${h.status}: ${h.reason}`, data: { status: h.status } });
    });
  }

  get lastPolicyDecision(): SettlementDecision | null {
    return this.lastDecision;
  }

  start(tickMs: number) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo completo. Reentrancia protegida: si un tick tarda (L1 lenta), los siguientes se saltan. */
  async tick(now = Date.now()): Promise<HealthSnapshot> {
    if (this.running) return this.monitor.current();
    this.running = true;
    try {
      const health = await this.monitor.probe(now);
      if (health.status !== 'DOWN') await this.scanDeposits();
      this.maybeSeal(now);
      await this.settleNext(health, now);
      this.finalize(health, now);
      return health;
    } finally {
      this.running = false;
    }
  }

  private maybeSeal(now: number) {
    if (this.seqr.pendingCount === 0) return;
    if (!this.seqr.shouldSealBySize && now - this.lastSealAt < this.cfg.sealIntervalMs) return;
    // Sella tantos lotes como haga falta para que ninguno exceda los límites de la tx L1.
    do {
      const b = this.seqr.sealBatch(now);
      if (!b) break;
      this.log({ at: now, kind: 'seal', message: `lote #${b.index} sellado: ${b.txCount} txs, ${b.txData.length} bytes, raíz ${b.newStateRoot.slice(0, 16)}…`, data: { index: b.index.toString(), txCount: b.txCount } });
    } while (this.seqr.shouldSealBySize);
    this.lastSealAt = now;
  }

  private async scanDeposits() {
    const from = Number(this.store.getMeta(META_DEPOSIT_LEDGER) ?? this.cfg.depositScanStartLedger);
    try {
      const { deposits, latestLedger } = await this.l1.fetchDeposits(from, this.cfg.depositBatchLimit ?? 200);
      deposits.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
      let maxLedger = from;
      for (const d of deposits) {
        const r = this.seqr.ingestDeposit(d);
        if (r) this.log({ at: Date.now(), kind: 'deposit', message: `depósito #${d.index} acreditado: ${d.amount} → ${d.l2Recipient.slice(0, 8)}… (ledger ${d.ledger})`, data: { index: d.index.toString() } });
        maxLedger = Math.max(maxLedger, d.ledger);
      }
      // Si no hay depósitos nuevos, avanzamos el cursor al último ledger para no re-escanear.
      const cursor = deposits.length > 0 ? maxLedger : latestLedger;
      if (cursor > from) this.store.setMeta(META_DEPOSIT_LEDGER, String(cursor));
    } catch (e) {
      this.log({ at: Date.now(), kind: 'error', message: `escaneo de depósitos falló: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private async settleNext(health: HealthSnapshot, now: number) {
    const sealed = this.store.batchesByStatus('sealed');
    if (sealed.length === 0) {
      this.lastDecision = null;
      return;
    }
    const batch = sealed[0];
    const hasWithdrawals = this.store.withdrawalsForBatch(batch.index).length > 0;
    const decision = decideSettlement(health, { sealedAt: batch.sealedAt, hasWithdrawals, attempts: batch.attempts, lastAttemptAt: batch.lastAttemptAt }, now, this.cfg);
    this.lastDecision = decision;
    if (decision.action !== 'COMMIT') {
      if (decision.reason !== this.lastDecisionReason) {
        this.log({ at: now, kind: decision.action === 'HOLD' ? 'hold' : 'defer', message: `lote #${batch.index}: ${decision.action} — ${decision.reason}`, data: { index: batch.index.toString(), pendingBatches: sealed.length } });
        this.lastDecisionReason = decision.reason;
      }
      return;
    }
    this.lastDecisionReason = '';
    // `now` es el instante del tick; publicar en Stellar tarda segundos. Si marcáramos el lote
    // con `now`, sellado y publicación quedarían con el mismo sello de tiempo y la métrica
    // "de sellado a L1" saldría 0. Medimos lo que realmente tardó la llamada.
    const startedAt = Date.now();
    try {
      const res = await this.l1.commitBatch(
        { batchIndex: batch.index, prevStateRoot: batch.prevStateRoot, newStateRoot: batch.newStateRoot, withdrawalsRoot: batch.withdrawalsRoot, txCount: batch.txCount, depositCursor: batch.depositCursor, txData: batch.txData },
        decision.maxInclusionFeeStroops,
      );
      this.store.markBatchCommitted(batch.index, res.txHash, res.ledger, now + (Date.now() - startedAt));
      this.log({ at: Date.now(), kind: 'commit', message: `lote #${batch.index} publicado en Stellar: tx ${res.txHash.slice(0, 12)}… ledger ${res.ledger} (${decision.reason})`, data: { index: batch.index.toString(), txHash: res.txHash, ledger: res.ledger, fee: decision.maxInclusionFeeStroops } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof L1Error ? e.kind : 'UNKNOWN';
      this.store.markBatchAttempt(batch.index, now, `${kind}: ${msg}`);
      this.log({ at: Date.now(), kind: 'commit_failed', message: `lote #${batch.index} no se pudo publicar (${kind}): ${msg}. Reintento con backoff.`, data: { index: batch.index.toString(), kind } });
      if (kind === 'TX_FAILED' && msg.includes('InvalidBatchIndex')) {
        // El contrato ya tiene este lote (commit anterior entró aunque creímos que falló).
        await this.reconcile(batch.index);
      }
    }
  }

  /** Si el contrato ya registró el lote, lo marcamos como committed en vez de reintentar para siempre. */
  private async reconcile(index: bigint) {
    try {
      const st = await this.l1.getBridgeState();
      if (st.batchCount > index) {
        this.store.markBatchCommitted(index, 'reconciled', st.lastCommitLedger, Date.now());
        this.log({ at: Date.now(), kind: 'commit', message: `lote #${index} ya estaba en el contrato (reconciliado; ledger ${st.lastCommitLedger})` });
      }
    } catch {
      /* se reintentará en el próximo tick */
    }
  }

  private finalize(health: HealthSnapshot, now: number) {
    if (health.latestLedger === null) return;
    for (const b of this.store.batchesByStatus('committed')) {
      if (b.commitLedger !== null && health.latestLedger >= b.commitLedger + this.cfg.challengePeriodLedgers) {
        this.store.markBatchFinalized(b.index, now);
        this.log({ at: Date.now(), kind: 'finalized', message: `lote #${b.index} finalizado (periodo de desafío cumplido): retiros reclamables en L1`, data: { index: b.index.toString() } });
      }
    }
  }
}
