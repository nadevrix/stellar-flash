/**
 * Secuenciador de Stellar Flash.
 *
 * Responsabilidad: recibir transacciones L2, ejecutarlas **en el acto** contra la máquina de
 * estado (finalidad L2 en < 1 ms), persistirlas en el log y agruparlas en lotes que el
 * `SettlementEngine` publicará en Stellar cuando la L1 esté sana.
 *
 * Igual que el secuenciador de Arbitrum One: un solo operador ordena las txs (rápido, simple), y
 * la seguridad de los fondos NO depende de él gracias al contrato (`withdraw` con prueba Merkle,
 * `escape`, `reclaim_deposit`).
 */
import {
  FlashError,
  FlashState,
  encodeBatchData,
  encodeTx,
  getProof,
  sha256,
  toHex,
  txFromJson,
  txId,
  txToJson,
  withdrawalsTree,
  type BalanceProof,
  type DepositTx,
  type L2Tx,
  type SignedTx,
  type WithdrawalRecord,
} from '../../../protocol/src/index.ts';
import type { BatchRecord, Store, TxRecord } from '../db/store.ts';

export interface Receipt {
  id: string;
  seq: number;
  type: L2Tx['type'];
  status: 'confirmed';
  /** Finalidad L2 inmediata; la L1 llega cuando el lote se publica y finaliza. */
  finality: { l2: 'instant'; l1: 'pending' };
  batchIndex: null;
  latencyUs: number;
  timestamp: number;
}

export interface DepositEvent {
  index: bigint;
  from: string;
  token: string;
  amount: bigint;
  l2Recipient: string;
  ledger: number;
  l1TxHash: string;
}

export interface SequencerOptions {
  domain: Uint8Array;
  store: Store;
  allowedTokens?: Set<string>;
  maxBatchBytes: number;
  maxBatchTxs: number;
  /** Cada cuántas txs guardar un snapshot del estado (arranque rápido). */
  snapshotEvery?: number;
}

export interface WithdrawalProof {
  txId: string;
  batchIndex: string;
  wIndex: number;
  recipient: string;
  token: string;
  amount: string;
  proof: string[];
  withdrawalsRoot: string;
  batchStatus: BatchRecord['status'];
  l1TxHash: string | null;
  commitLedger: number | null;
  /** `true` cuando el lote está finalizado y `withdraw` en el contrato ya se puede llamar. */
  claimable: boolean;
}

interface PendingTx {
  tx: L2Tx;
  id: string;
  seq: number;
  bytes: number;
  withdrawal?: Omit<WithdrawalRecord, 'wIndex'>;
}

export class Sequencer {
  readonly state: FlashState;
  readonly store: Store;
  private readonly domain: Uint8Array;
  private readonly maxBatchBytes: number;
  private readonly maxBatchTxs: number;
  private readonly snapshotEvery: number;

  private seq: number;
  private nextBatchIndex: bigint;
  private lastBatchRoot: string;
  /** Txs ejecutadas y persistidas que aún no pertenecen a un lote, en orden de secuencia. */
  private pending: PendingTx[] = [];
  private pendingBytes = 0;
  /** Latencias medidas aún no escritas al log (seq → µs). Se vuelcan al sellar. */
  private readonly latencies = new Map<number, number>();

  private constructor(opts: SequencerOptions, state: FlashState, seq: number, nextBatchIndex: bigint, lastBatchRoot: string) {
    this.domain = opts.domain;
    this.store = opts.store;
    this.state = state;
    this.maxBatchBytes = opts.maxBatchBytes;
    this.maxBatchTxs = opts.maxBatchTxs;
    this.snapshotEvery = opts.snapshotEvery ?? 500;
    this.seq = seq;
    this.nextBatchIndex = nextBatchIndex;
    this.lastBatchRoot = lastBatchRoot;
  }

  /** Abre el secuenciador reconstruyendo el estado desde la base de datos (snapshot + replay). */
  static open(opts: SequencerOptions): Sequencer {
    const { store, domain } = opts;
    const stateOpts = { allowedTokens: opts.allowedTokens };
    const snap = store.loadSnapshot();
    let state: FlashState;
    let replayFrom = 0;
    if (snap) {
      state = FlashState.fromSnapshot(domain, JSON.parse(snap.json), stateOpts);
      replayFrom = snap.lastSeq;
    } else {
      state = new FlashState(domain, stateOpts);
    }
    // Replay del log (event sourcing). Las txs persistidas fueron válidas al aplicarse → deben serlo ahora.
    let batchLoop = true;
    while (batchLoop) {
      const rows = store.txsAfter(replayFrom, 5_000);
      for (const r of rows) {
        state.apply(txFromJson(JSON.parse(r.json)));
        replayFrom = r.seq;
      }
      batchLoop = rows.length === 5_000;
    }
    const last = store.lastBatch();
    const nextBatchIndex = last ? last.index + 1n : 0n;
    const lastRoot = last ? last.newStateRoot : toHex(new Uint8Array(32));
    const seqr = new Sequencer(opts, state, store.lastSeq(), nextBatchIndex, lastRoot);
    // Txs ya persistidas pero aún sin lote (proceso reiniciado antes de sellar) → vuelven a pendientes.
    const unbatched = store.txsAfter(last ? last.lastSeq : 0);
    if (unbatched.length > 0) seqr.reloadPending(unbatched);
    return seqr;
  }

  private reloadPending(rows: TxRecord[]) {
    // Re-deriva los pendientes desde el log (sin tocar el estado, que ya fue reconstruido).
    for (const r of rows) {
      const tx = txFromJson(JSON.parse(r.json));
      const withdrawal = tx.type === 'withdraw' ? { recipient: tx.l1Recipient, token: tx.token, amount: tx.amount } : undefined;
      this.pushPending({ tx, id: r.id, seq: r.seq, bytes: encodeTx(tx).length + 2, withdrawal });
    }
  }

  private pushPending(p: PendingTx) {
    this.pending.push(p);
    this.pendingBytes += p.bytes;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get pendingByteSize(): number {
    return this.pendingBytes;
  }

  get pendingHasWithdrawals(): boolean {
    return this.pending.some((p) => p.withdrawal !== undefined);
  }

  get currentSeq(): number {
    return this.seq;
  }

  get nextBatch(): bigint {
    return this.nextBatchIndex;
  }

  /** Un lote "lleno" debería sellarse aunque no haya pasado el intervalo. */
  get shouldSealBySize(): boolean {
    return this.pendingBytes >= this.maxBatchBytes || this.pending.length >= this.maxBatchTxs;
  }

  /**
   * Ejecuta una transacción firmada por un usuario. Síncrono: al retornar, la tx es final en L2.
   * Lanza `FlashError` si es inválida (la tx NO se persiste).
   */
  submit(tx: SignedTx): Receipt {
    const t0 = process.hrtime.bigint();
    this.state.validate(tx); // lanza FlashError sin tocar el estado
    const id = txId(tx, this.domain);
    if (this.store.getTx(id)) throw new FlashError('BAD_NONCE', 'transacción duplicada', { id });
    return this.record(tx, id, t0);
  }

  /** Acredita un depósito visto en L1 (evento del contrato). Idempotente por índice. */
  ingestDeposit(ev: DepositEvent): Receipt | null {
    if (ev.index < this.state.nextDepositIndex) return null; // ya acreditado
    const tx: DepositTx = { type: 'deposit', depositIndex: ev.index, to: ev.l2Recipient, token: ev.token, amount: ev.amount, l1TxHash: ev.l1TxHash };
    const t0 = process.hrtime.bigint();
    this.state.validate(tx);
    const id = txId(tx, this.domain);
    const receipt = this.record(tx, id, t0, () =>
      this.store.insertDeposit({ index: ev.index, from: ev.from, token: ev.token, amount: ev.amount.toString(), l2Recipient: ev.l2Recipient, ledger: ev.ledger, l1TxHash: ev.l1TxHash, txId: id }),
    );
    return receipt;
  }

  /**
   * Orden: persistir primero (log = fuente de verdad) y después mutar el estado. Si el disco falla,
   * el estado en memoria no queda adelantado respecto al log.
   */
  private record(tx: L2Tx, id: string, t0: bigint, extraPersist?: () => void): Receipt {
    const seq = this.seq + 1;
    const now = Date.now();
    const rec: TxRecord = {
      id,
      seq,
      type: tx.type,
      from: tx.type === 'deposit' ? null : tx.from,
      to: tx.type === 'transfer' ? tx.to : tx.type === 'deposit' ? tx.to : tx.l1Recipient,
      token: tx.token,
      amount: tx.amount.toString(),
      json: JSON.stringify(txToJson(tx)),
      batchIndex: null,
      createdAt: now,
      latencyUs: 0,
    };
    this.store.transaction(() => {
      this.store.insertTx(rec);
      extraPersist?.();
    });
    const withdrawal = this.state.apply(tx); // ya validada arriba: no lanza
    this.seq = seq;
    const latencyUs = Number((process.hrtime.bigint() - t0) / 1000n);
    // La fila ya está escrita con latencia 0: la real solo se conoce aquí. Se acumula y se
    // vuelca al sellar, para no meter otra escritura en la ruta caliente.
    this.latencies.set(seq, latencyUs);
    this.pushPending({ tx, id, seq, bytes: encodeTx(tx).length + 2, withdrawal });
    if (this.seq % this.snapshotEvery === 0) this.saveSnapshot();
    return { id, seq: this.seq, type: tx.type, status: 'confirmed', finality: { l2: 'instant', l1: 'pending' }, batchIndex: null, latencyUs, timestamp: now };
  }

  saveSnapshot() {
    this.store.saveSnapshot(this.seq, this.state.rootHex(), JSON.stringify(this.state.snapshot()), Date.now());
  }

  /**
   * Cierra el lote actual: calcula la nueva raíz de estado, la raíz de retiros y los datos crudos
   * que irán a L1. Devuelve `null` si no hay txs pendientes.
   */
  sealBatch(now = Date.now()): BatchRecord | null {
    if (this.pending.length === 0) return null;
    // Prefijo que cabe en el lote (límites de bytes/txs de la tx Soroban de L1). El resto sigue pendiente.
    let count = 0;
    let bytes = 4; // cabecera u32 count
    while (count < this.pending.length && count < this.maxBatchTxs) {
      const next = this.pending[count].bytes;
      if (count > 0 && bytes + next > this.maxBatchBytes) break;
      bytes += next;
      count += 1;
    }
    const taken = this.pending.slice(0, count);
    const rest = this.pending.slice(count);
    const index = this.nextBatchIndex;
    const txData = encodeBatchData(taken.map((p) => p.tx));

    // La raíz de estado del lote es el estado *tras la última tx incluida*. Si quedan txs fuera,
    // hay que recomputar el estado intermedio: re-ejecutamos las incluidas sobre el estado del lote anterior.
    let newRoot: string;
    let depositCursor: bigint;
    if (rest.length === 0) {
      newRoot = this.state.rootHex();
      depositCursor = this.state.nextDepositIndex;
    } else {
      const intermediate = this.rebuildStateUpTo(taken[taken.length - 1].seq);
      newRoot = intermediate.rootHex();
      depositCursor = intermediate.nextDepositIndex;
    }
    const withdrawals: (WithdrawalRecord & { txId: string })[] = [];
    for (const p of taken) if (p.withdrawal) withdrawals.push({ txId: p.id, wIndex: withdrawals.length, ...p.withdrawal });
    const wTree = withdrawalsTree(index, withdrawals);
    const batch: BatchRecord = {
      index,
      prevStateRoot: this.lastBatchRoot,
      newStateRoot: newRoot,
      withdrawalsRoot: toHex(wTree.root),
      txCount: taken.length,
      depositCursor,
      txDataHash: toHex(sha256(txData)),
      txData,
      firstSeq: taken[0].seq,
      lastSeq: taken[taken.length - 1].seq,
      status: 'sealed',
      l1TxHash: null,
      commitLedger: null,
      sealedAt: now,
      committedAt: null,
      finalizedAt: null,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    };
    const latencies = [...this.latencies].filter(([seq]) => seq >= batch.firstSeq && seq <= batch.lastSeq);
    this.store.transaction(() => {
      this.store.insertBatch(batch);
      this.store.assignBatch(batch.firstSeq, batch.lastSeq, index);
      this.store.setTxLatencies(latencies);
      for (const w of withdrawals) {
        this.store.insertWithdrawal({ txId: w.txId, batchIndex: index, wIndex: w.wIndex, recipient: w.recipient, token: w.token, amount: w.amount.toString() });
      }
    });
    for (const [seq] of latencies) this.latencies.delete(seq);
    this.pending = rest;
    this.pendingBytes = rest.reduce((a, p) => a + p.bytes, 0);
    this.nextBatchIndex = index + 1n;
    this.lastBatchRoot = newRoot;
    this.saveSnapshot();
    return batch;
  }

  /** Estado tras aplicar el log hasta `seq` inclusive (solo se usa al partir un lote por tamaño). */
  private rebuildStateUpTo(seq: number): FlashState {
    const last = this.store.lastBatch();
    const from = last ? last.lastSeq : 0;
    const base = last ? this.stateAtBatchEnd(last) : new FlashState(this.domain);
    for (const r of this.store.txsAfter(from, seq - from)) {
      if (r.seq > seq) break;
      base.apply(txFromJson(JSON.parse(r.json)));
    }
    return base;
  }

  /** Reconstruye el estado al final de un lote re-ejecutando todo el log hasta él (coste O(n); solo en el camino raro). */
  private stateAtBatchEnd(batch: BatchRecord): FlashState {
    const st = new FlashState(this.domain);
    let from = 0;
    for (;;) {
      const rows = this.store.txsAfter(from, 5_000);
      for (const r of rows) {
        if (r.seq > batch.lastSeq) return st;
        st.apply(txFromJson(JSON.parse(r.json)));
        from = r.seq;
      }
      if (rows.length < 5_000) return st;
    }
  }

  /** Prueba Merkle del saldo actual (para `escape` en el puente). Nota: válida contra la raíz del estado actual. */
  balanceProof(account: string, token: string): BalanceProof {
    return this.state.proofFor(account, token);
  }

  /** Prueba Merkle de un retiro ya incluido en un lote (para `withdraw` en el puente). */
  withdrawalProof(txIdHex: string): WithdrawalProof | null {
    const w = this.store.getWithdrawal(txIdHex);
    if (!w) return null;
    const batch = this.store.getBatch(w.batchIndex);
    if (!batch) return null;
    const all = this.store.withdrawalsForBatch(w.batchIndex).map((r) => ({ wIndex: r.wIndex, recipient: r.recipient, token: r.token, amount: BigInt(r.amount) }));
    const tree = withdrawalsTree(w.batchIndex, all);
    if (toHex(tree.root) !== batch.withdrawalsRoot) throw new Error('inconsistencia: raíz de retiros no coincide con el lote');
    return {
      txId: w.txId,
      batchIndex: w.batchIndex.toString(),
      wIndex: w.wIndex,
      recipient: w.recipient,
      token: w.token,
      amount: w.amount,
      proof: getProof(tree, w.wIndex).map(toHex),
      withdrawalsRoot: batch.withdrawalsRoot,
      batchStatus: batch.status,
      l1TxHash: batch.l1TxHash,
      commitLedger: batch.commitLedger,
      claimable: batch.status === 'finalized',
    };
  }
}
