/**
 * Abstracción de la L1 (Stellar) que usa el motor de settlement. Dos implementaciones:
 *  - `MockL1Client` (este archivo): cadena simulada en memoria con salud controlable. Sirve para
 *    tests y para la demo "Stellar se cae → Flash sigue".
 *  - `StellarRpcL1Client` (`rpc-client.ts`): Stellar real vía Stellar RPC + contrato `flash-bridge`.
 */
import { sha256, toHex, utf8 } from '../../../protocol/src/index.ts';
import type { DepositEvent } from '../core/sequencer.ts';

export interface EndpointProbe {
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  latestLedger?: number;
  /** Unix seconds del cierre del último ledger conocido por el endpoint. */
  latestLedgerCloseTime?: number;
  /** Fee de inclusión Soroban (stroops) según `getFeeStats`. */
  feeP50?: number;
  feeP90?: number;
  error?: string;
}

export interface CommitBatchArgs {
  batchIndex: bigint;
  prevStateRoot: string;
  newStateRoot: string;
  withdrawalsRoot: string;
  txCount: number;
  depositCursor: bigint;
  txData: Uint8Array;
}

export interface CommitResult {
  txHash: string;
  ledger: number;
  /** Fee total pagada (stroops), si se conoce. */
  feeCharged?: number;
}

export interface BridgeState {
  batchCount: bigint;
  depositCount: bigint;
  stateRoot: string;
  lastCommitLedger: number;
  challengePeriodLedgers: number;
}

export class L1Error extends Error {
  readonly kind: 'NETWORK' | 'TRY_AGAIN_LATER' | 'TX_FAILED' | 'TIMEOUT' | 'CONFIG';
  constructor(kind: L1Error['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface L1Client {
  readonly endpoints: string[];
  probe(timeoutMs: number): Promise<EndpointProbe[]>;
  getBridgeState(): Promise<BridgeState>;
  commitBatch(args: CommitBatchArgs, maxInclusionFeeStroops: number): Promise<CommitResult>;
  /** Eventos `deposit` del puente en (fromLedger, toLedger]. */
  fetchDeposits(fromLedger: number, limit: number): Promise<{ deposits: DepositEvent[]; latestLedger: number }>;
  /**
   * Lee un depósito del ESTADO del contrato (no del evento). El evento es solo un aviso: un RPC
   * comprometido puede inventárselo. La única fuente de verdad es el contrato.
   */
  getDeposit(index: bigint): Promise<VerifiedDeposit | null>;
  /** Saldo real del puente en un token, para comprobar la solvencia de lo emitido. */
  getVaultBalance(token: string): Promise<bigint>;
}

/** Depósito tal como lo guarda el contrato. */
export interface VerifiedDeposit {
  from: string;
  token: string;
  amount: bigint;
  l2Recipient: string;
  ledger: number;
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

export type MockMode = 'healthy' | 'degraded' | 'down' | 'slow';

export interface MockL1Options {
  startLedger?: number;
  challengePeriodLedgers?: number;
  /** Segundos entre ledgers simulados. */
  ledgerIntervalSec?: number;
  now?: () => number;
}

interface MockBatch extends CommitBatchArgs {
  txHash: string;
  ledger: number;
}

/**
 * L1 simulada. `mode` controla el comportamiento:
 *  - healthy: responde rápido, fees base.
 *  - degraded: responde, pero con fees de surge pricing y ledgers atrasados.
 *  - down: los endpoints no responden (como el incidente de RPC de feb-2026) y las txs no entran.
 *  - slow: responde con latencia alta y a veces TRY_AGAIN_LATER.
 */
export class MockL1Client implements L1Client {
  readonly endpoints = ['mock://rpc-a', 'mock://rpc-b'];
  mode: MockMode = 'healthy';
  private ledger: number;
  private lastCloseAt: number;
  private readonly ledgerIntervalSec: number;
  private readonly challenge: number;
  private readonly now: () => number;
  readonly batches: MockBatch[] = [];
  readonly deposits: DepositEvent[] = [];
  commitCalls = 0;
  private tryAgainEvery = 0;

  constructor(opts: MockL1Options = {}) {
    this.ledger = opts.startLedger ?? 1_000_000;
    this.ledgerIntervalSec = opts.ledgerIntervalSec ?? 5;
    this.challenge = opts.challengePeriodLedgers ?? 20;
    this.now = opts.now ?? (() => Date.now());
    this.lastCloseAt = Math.floor(this.now() / 1000);
  }

  /** Avanza la cadena simulada `n` ledgers (si no está caída). */
  advanceLedgers(n = 1) {
    if (this.mode === 'down') return; // la red no cierra ledgers visibles para nosotros
    this.ledger += n;
    this.lastCloseAt = Math.floor(this.now() / 1000);
  }

  get latestLedger(): number {
    return this.ledger;
  }

  /** Simula un usuario llamando `deposit` en el contrato. */
  deposit(from: string, token: string, amount: bigint, l2Recipient: string): DepositEvent {
    if (this.mode === 'down') throw new L1Error('NETWORK', 'mock L1 caída: no se puede depositar');
    const index = BigInt(this.deposits.length);
    const ev: DepositEvent = {
      index,
      from,
      token,
      amount,
      l2Recipient,
      ledger: this.ledger,
      l1TxHash: toHex(sha256(utf8(`mock-deposit-${index}-${from}-${amount}`))),
    };
    this.deposits.push(ev);
    this.recorded.set(index, { from, token, amount, l2Recipient, ledger: ev.ledger });
    return ev;
  }

  async probe(_timeoutMs: number): Promise<EndpointProbe[]> {
    return this.endpoints.map((endpoint, i) => {
      if (this.mode === 'down') return { endpoint, ok: false, latencyMs: _timeoutMs, error: 'timeout (ECONNRESET)' };
      const degraded = this.mode === 'degraded';
      return {
        endpoint,
        ok: true,
        latencyMs: this.mode === 'slow' ? 2_500 + i * 100 : 80 + i * 20,
        latestLedger: this.ledger,
        latestLedgerCloseTime: degraded ? this.lastCloseAt - 25 : this.lastCloseAt,
        feeP50: degraded ? 5_000 : 100,
        feeP90: degraded ? 25_000 : 200,
      };
    });
  }

  async getBridgeState(): Promise<BridgeState> {
    if (this.mode === 'down') throw new L1Error('NETWORK', 'mock L1 caída');
    const last = this.batches.at(-1);
    return {
      batchCount: BigInt(this.batches.length),
      depositCount: BigInt(this.deposits.length),
      stateRoot: last?.newStateRoot ?? toHex(new Uint8Array(32)),
      lastCommitLedger: last?.ledger ?? 0,
      challengePeriodLedgers: this.challenge,
    };
  }

  async commitBatch(args: CommitBatchArgs, maxInclusionFeeStroops: number): Promise<CommitResult> {
    this.commitCalls += 1;
    if (this.mode === 'down') throw new L1Error('NETWORK', 'fetch failed: mock RPC no responde');
    if (this.mode === 'slow') {
      this.tryAgainEvery += 1;
      if (this.tryAgainEvery % 2 === 1) throw new L1Error('TRY_AGAIN_LATER', 'TRY_AGAIN_LATER: cola de transacciones llena');
    }
    if (this.mode === 'degraded' && maxInclusionFeeStroops < 25_000) {
      // Puja insuficiente durante surge pricing: la tx no entra en el ledger.
      throw new L1Error('TIMEOUT', `fee ${maxInclusionFeeStroops} < p90 25000: tx expiró sin incluirse (surge pricing)`);
    }
    // Reproduce las validaciones del contrato
    if (args.batchIndex !== BigInt(this.batches.length)) throw new L1Error('TX_FAILED', `InvalidBatchIndex: esperado ${this.batches.length}`);
    const prev = this.batches.at(-1)?.newStateRoot ?? toHex(new Uint8Array(32));
    if (args.prevStateRoot !== prev) throw new L1Error('TX_FAILED', 'StateRootMismatch');
    if (args.txCount === 0) throw new L1Error('TX_FAILED', 'EmptyBatch');
    const prevCursor = this.batches.at(-1)?.depositCursor ?? 0n;
    if (args.depositCursor < prevCursor || args.depositCursor > BigInt(this.deposits.length)) throw new L1Error('TX_FAILED', 'InvalidDepositCursor');
    this.advanceLedgers(1);
    const txHash = toHex(sha256(utf8(`mock-commit-${args.batchIndex}`), args.txData));
    this.batches.push({ ...args, txHash, ledger: this.ledger });
    return { txHash, ledger: this.ledger, feeCharged: Math.min(maxInclusionFeeStroops, this.mode === 'degraded' ? 25_000 : 200) + 50_000 };
  }

  /**
   * Depósitos que el "contrato" tiene registrados de verdad. En los tests se puede añadir a
   * `deposits` un evento SIN registrarlo aquí para simular un RPC que se inventa depósitos.
   */
  readonly recorded = new Map<bigint, VerifiedDeposit>();

  /** Ledger simulado actual (los tests lo necesitan para situar eventos). */
  get currentLedger(): number {
    return this.ledger;
  }

  async getDeposit(index: bigint): Promise<VerifiedDeposit | null> {
    if (this.mode === 'down') throw new L1Error('NETWORK', 'mock L1 caída');
    return this.recorded.get(index) ?? null;
  }

  async getVaultBalance(token: string): Promise<bigint> {
    if (this.mode === 'down') throw new L1Error('NETWORK', 'mock L1 caída');
    let total = 0n;
    for (const d of this.recorded.values()) if (d.token === token) total += d.amount;
    return total - (this.claimed.get(token) ?? 0n);
  }

  /** Retiros ya reclamados en L1: salen de la bóveda. */
  readonly claimed = new Map<string, bigint>();

  async fetchDeposits(fromLedger: number, limit: number): Promise<{ deposits: DepositEvent[]; latestLedger: number }> {
    if (this.mode === 'down') throw new L1Error('NETWORK', 'mock L1 caída');
    const deposits = this.deposits.filter((d) => d.ledger > fromLedger).slice(0, limit);
    return { deposits, latestLedger: this.ledger };
  }
}
