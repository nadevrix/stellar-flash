/**
 * Operador del puente: el usuario nunca habla con Soroban RPC.
 *
 *  Onramp — paga XLM clásico (Horizon) a la cuenta del secuenciador. Nosotros invocamos
 *  `deposit` en el contrato (con failover) y el escáner de siempre acredita FXLM.
 *
 *  Offramp — el usuario quema FXLM (SEP-53, milisegundos). Cuando el lote finaliza,
 *  reclamamos `withdraw` en L1 y el XLM llega a su G… sin que firme una tx Soroban.
 *
 * Hay una ventana breve en la que el XLM está en la cuenta del secuenciador, no en la
 * bóveda. El 1:1 on-chain empieza en cuanto `relayDeposit` entra. Fondos ya acreditados
 * siguen saliendo por Merkle / escape, igual que antes.
 */
import type { Sequencer } from '../core/sequencer.ts';
import type { Store } from '../db/store.ts';
import { L1Error, type L1Client } from './l1.ts';

export type OperatorLog = (ev: { at: number; kind: string; message: string; data?: Record<string, unknown> }) => void;

export interface IncomingPayment {
  id: string;
  hash: string;
  from: string;
  amount: bigint;
  cursor: string;
}

export interface PaymentFeed {
  /** Pagos nativos recibidos después de `cursor` (paging_token de Horizon). */
  fetchIncoming(cursor: string | null): Promise<{ payments: IncomingPayment[]; cursor: string | null }>;
  /** Último paging_token conocido, para ignorar el historial al activar el onramp. */
  tipCursor(): Promise<string | null>;
}

const META_CURSOR = 'onramp_horizon_cursor';

export function parseStroops(amount: string): bigint {
  const t = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`monto Horizon inválido: ${amount}`);
  const [w, f = ''] = t.split('.');
  if (f.length > 7) throw new Error(`demasiados decimales: ${amount}`);
  return BigInt(w) * 10_000_000n + BigInt((f + '0000000').slice(0, 7));
}

export class HorizonPaymentFeed implements PaymentFeed {
  private readonly horizonUrl: string;
  private readonly account: string;

  constructor(horizonUrl: string, account: string) {
    this.horizonUrl = horizonUrl;
    this.account = account;
  }

  private async get(path: string, params: Record<string, string>): Promise<{ records: HorizonPayment[]; pagingToken: string | null }> {
    const u = new URL(`${this.horizonUrl.replace(/\/$/, '')}${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { accept: 'application/json' } });
    if (res.status === 404) return { records: [], pagingToken: null };
    if (!res.ok) throw new Error(`horizon HTTP ${res.status}`);
    const body = (await res.json()) as { _embedded?: { records?: HorizonPayment[] } };
    const records = body._embedded?.records ?? [];
    return { records, pagingToken: records.at(-1)?.paging_token ?? null };
  }

  async tipCursor(): Promise<string | null> {
    const { records } = await this.get(`/accounts/${this.account}/payments`, { order: 'desc', limit: '1' });
    return records[0]?.paging_token ?? null;
  }

  async fetchIncoming(cursor: string | null): Promise<{ payments: IncomingPayment[]; cursor: string | null }> {
    const params: Record<string, string> = { order: 'asc', limit: '50' };
    if (cursor) params.cursor = cursor;
    const { records, pagingToken } = await this.get(`/accounts/${this.account}/payments`, params);
    const payments: IncomingPayment[] = [];
    for (const r of records) {
      if (r.type !== 'payment' || r.asset_type !== 'native') continue;
      if (r.to !== this.account || r.from === this.account) continue;
      payments.push({
        id: r.id,
        hash: r.transaction_hash,
        from: r.from,
        amount: parseStroops(r.amount),
        cursor: r.paging_token,
      });
    }
    return { payments, cursor: pagingToken ?? cursor };
  }
}

interface HorizonPayment {
  id: string;
  paging_token: string;
  transaction_hash: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  asset_type: string;
}

export class MockPaymentFeed implements PaymentFeed {
  readonly queue: IncomingPayment[] = [];
  tip: string | null = null;

  push(p: IncomingPayment) {
    this.queue.push(p);
  }

  async tipCursor(): Promise<string | null> {
    return this.tip;
  }

  async fetchIncoming(cursor: string | null): Promise<{ payments: IncomingPayment[]; cursor: string | null }> {
    const payments = this.queue.splice(0);
    return { payments, cursor: payments.at(-1)?.cursor ?? cursor };
  }
}

export interface OperatorConfig {
  store: Store;
  l1: L1Client;
  sequencer: Sequencer;
  feed: PaymentFeed;
  sequencerAccount: string;
  token: string;
  minAmount: bigint;
  enabled: boolean;
  autoclaim: boolean;
  skipHistorical: boolean;
  maxInclusionFeeStroops: number;
  perTick?: number;
  log?: OperatorLog;
}

export class BridgeOperator {
  private readonly store: Store;
  private readonly l1: L1Client;
  private readonly seqr: Sequencer;
  private readonly feed: PaymentFeed;
  readonly sequencerAccount: string;
  readonly token: string;
  readonly minAmount: bigint;
  readonly enabled: boolean;
  readonly autoclaim: boolean;
  private readonly skipHistorical: boolean;
  private readonly fee: number;
  private readonly perTick: number;
  private readonly log: OperatorLog;

  constructor(cfg: OperatorConfig) {
    this.store = cfg.store;
    this.l1 = cfg.l1;
    this.seqr = cfg.sequencer;
    this.feed = cfg.feed;
    this.sequencerAccount = cfg.sequencerAccount;
    this.token = cfg.token;
    this.minAmount = cfg.minAmount;
    this.enabled = cfg.enabled;
    this.autoclaim = cfg.autoclaim;
    this.skipHistorical = cfg.skipHistorical;
    this.fee = cfg.maxInclusionFeeStroops;
    this.perTick = cfg.perTick ?? 3;
    this.log = cfg.log ?? (() => {});
  }

  private emit(kind: 'onramp' | 'offramp' | 'error', message: string, data?: Record<string, unknown>) {
    this.log({ at: Date.now(), kind, message, data });
  }

  /** Ingesta pagos Horizon y los mete en la bóveda. No acredita FXLM: eso lo hace el escáner. */
  async ingest(): Promise<void> {
    if (!this.enabled) return;
    try {
      if (this.skipHistorical && this.store.getMeta(META_CURSOR) === undefined) {
        const tip = await this.feed.tipCursor();
        this.store.setMeta(META_CURSOR, tip ?? '');
        this.emit('onramp', `onramp listo; pagos anteriores a cursor ${tip ?? '(vacío)'} ignorados`);
        return;
      }
      const from = this.store.getMeta(META_CURSOR) ?? null;
      const page = await this.feed.fetchIncoming(from && from.length > 0 ? from : null);
      const now = Date.now();
      for (const p of page.payments) {
        this.store.insertOnramp({
          paymentId: p.id,
          txHash: p.hash,
          from: p.from,
          amount: p.amount.toString(),
          status: 'seen',
          depositTxHash: null,
          error: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (page.cursor && page.cursor !== from) this.store.setMeta(META_CURSOR, page.cursor);
    } catch (e) {
      this.emit('error', `onramp: Horizon no respondió: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const pending = this.store.pendingOnramps(this.perTick);
    for (const row of pending) {
      const amount = BigInt(row.amount);
      if (amount < this.minAmount) {
        this.store.updateOnramp(row.paymentId, { status: 'skipped', error: `por debajo del mínimo ${this.minAmount}`, updatedAt: Date.now() });
        continue;
      }
      try {
        const res = await this.l1.relayDeposit(this.token, amount, row.from, this.fee);
        this.store.updateOnramp(row.paymentId, { status: 'deposited', depositTxHash: res.txHash, error: null, updatedAt: Date.now() });
        this.emit('onramp', `XLM ${row.amount} de ${row.from.slice(0, 8)}… → bóveda (tx ${res.txHash.slice(0, 12)}…). FXLM al escanear el depósito.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.store.updateOnramp(row.paymentId, { status: 'failed', error: msg, updatedAt: Date.now() });
        this.emit('onramp', `onramp falló (${row.paymentId.slice(0, 12)}…): ${msg}`);
      }
    }
  }

  /** Reclama en L1 los retiros cuyo lote ya finalizó. */
  async claim(): Promise<void> {
    if (!this.autoclaim) return;
    const due = this.store.withdrawalsToClaim(this.perTick);
    for (const w of due) {
      const proof = this.seqr.withdrawalProof(w.txId);
      if (!proof?.claimable) continue;
      try {
        const res = await this.l1.claimWithdrawal(
          {
            batchIndex: BigInt(proof.batchIndex),
            wIndex: proof.wIndex,
            recipient: proof.recipient,
            token: proof.token,
            amount: BigInt(proof.amount),
            proof: proof.proof,
          },
          this.fee,
        );
        this.store.upsertOfframp({ txId: w.txId, status: 'claimed', claimTxHash: res.txHash, error: null, updatedAt: Date.now() });
        this.emit('offramp', `retiro ${w.txId.slice(0, 12)}… pagado en Stellar (tx ${res.txHash.slice(0, 12)}…) → ${w.recipient.slice(0, 8)}…`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof L1Error && e.kind === 'TX_FAILED' && /AlreadyClaimed/.test(msg)) {
          this.store.upsertOfframp({ txId: w.txId, status: 'claimed', claimTxHash: null, error: null, updatedAt: Date.now() });
          continue;
        }
        this.store.upsertOfframp({ txId: w.txId, status: 'failed', claimTxHash: null, error: msg, updatedAt: Date.now() });
        this.emit('offramp', `auto-claim falló (${w.txId.slice(0, 12)}…): ${msg}`);
      }
    }
  }
}
