/**
 * Persistencia del secuenciador sobre SQLite (`node:sqlite`, incluido en Node ≥ 22.5).
 *
 * Modelo: **event sourcing**. La tabla `transactions` es el log ordenado (columna `seq`) y es la
 * fuente de verdad; el estado en memoria se reconstruye re-ejecutando el log (o desde el último
 * `snapshot`). Para producción el mismo esquema se traslada a PostgreSQL: ver
 * Persistence schema — see docs/06-sequencer-api.md §4.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type BatchStatus = 'sealed' | 'committed' | 'finalized';

export interface TxRecord {
  id: string;
  seq: number;
  type: 'transfer' | 'withdraw' | 'deposit';
  from: string | null;
  to: string | null;
  token: string;
  amount: string;
  json: string;
  batchIndex: bigint | null;
  createdAt: number;
  latencyUs: number;
}

export interface BatchRecord {
  index: bigint;
  prevStateRoot: string;
  newStateRoot: string;
  withdrawalsRoot: string;
  txCount: number;
  depositCursor: bigint;
  txDataHash: string;
  txData: Uint8Array;
  firstSeq: number;
  lastSeq: number;
  status: BatchStatus;
  l1TxHash: string | null;
  commitLedger: number | null;
  sealedAt: number;
  committedAt: number | null;
  finalizedAt: number | null;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

export interface WithdrawalRecord {
  txId: string;
  batchIndex: bigint;
  wIndex: number;
  recipient: string;
  token: string;
  amount: string;
}

export interface DepositRecord {
  index: bigint;
  from: string;
  token: string;
  amount: string;
  l2Recipient: string;
  ledger: number;
  l1TxHash: string;
  txId: string;
}

export interface HealthLogRecord {
  at: number;
  status: string;
  latestLedger: number | null;
  ledgerAgeSec: number | null;
  feeP50: number | null;
  feeP90: number | null;
  okEndpoints: number;
  totalEndpoints: number;
  reason: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  from_account TEXT,
  to_account TEXT,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  json TEXT NOT NULL,
  batch_index INTEGER,
  created_at INTEGER NOT NULL,
  latency_us INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_account, seq);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_account, seq);
CREATE INDEX IF NOT EXISTS idx_tx_batch ON transactions(batch_index);
CREATE TABLE IF NOT EXISTS batches (
  batch_index INTEGER PRIMARY KEY,
  prev_state_root TEXT NOT NULL,
  new_state_root TEXT NOT NULL,
  withdrawals_root TEXT NOT NULL,
  tx_count INTEGER NOT NULL,
  deposit_cursor INTEGER NOT NULL,
  tx_data_hash TEXT NOT NULL,
  tx_data BLOB NOT NULL,
  first_seq INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  l1_tx_hash TEXT,
  commit_ledger INTEGER,
  sealed_at INTEGER NOT NULL,
  committed_at INTEGER,
  finalized_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals (
  tx_id TEXT PRIMARY KEY,
  batch_index INTEGER NOT NULL,
  w_index INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  UNIQUE(batch_index, w_index)
);
CREATE TABLE IF NOT EXISTS deposits (
  deposit_index INTEGER PRIMARY KEY,
  from_account TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  l2_recipient TEXT NOT NULL,
  ledger INTEGER NOT NULL,
  l1_tx_hash TEXT NOT NULL,
  tx_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seq INTEGER NOT NULL,
  state_root TEXT NOT NULL,
  json TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  status TEXT NOT NULL,
  latest_ledger INTEGER,
  ledger_age_sec REAL,
  fee_p50 INTEGER,
  fee_p90 INTEGER,
  ok_endpoints INTEGER NOT NULL,
  total_endpoints INTEGER NOT NULL,
  reason TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- meta ----
  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return row ? String(row.value) : undefined;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- transactions ----
  insertTx(t: TxRecord) {
    this.db
      .prepare(
        `INSERT INTO transactions(seq, id, type, from_account, to_account, token, amount, json, batch_index, created_at, latency_us)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.seq, t.id, t.type, t.from, t.to, t.token, t.amount, t.json, t.batchIndex === null ? null : Number(t.batchIndex), t.createdAt, t.latencyUs);
  }

  getTx(id: string): TxRecord | undefined {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToTx(row) : undefined;
  }

  lastSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS m FROM transactions').get() as Row;
    return row.m === null ? 0 : Number(row.m);
  }

  txsAfter(seq: number, limit = 10_000): TxRecord[] {
    const rows = this.db.prepare('SELECT * FROM transactions WHERE seq > ? ORDER BY seq ASC LIMIT ?').all(seq, limit) as Row[];
    return rows.map(rowToTx);
  }

  txsForAccount(account: string, limit = 50): TxRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM transactions WHERE from_account = ? OR to_account = ? ORDER BY seq DESC LIMIT ?')
      .all(account, account, limit) as Row[];
    return rows.map(rowToTx);
  }

  /**
   * Escribe las latencias medidas. Se llama al sellar, no en cada pago: la latencia solo se
   * conoce después de persistir y aplicar, y un UPDATE por pago en la ruta caliente costaría
   * más que el propio pago.
   */
  setTxLatencies(entries: Iterable<[number, number]>) {
    const stmt = this.db.prepare('UPDATE transactions SET latency_us = ? WHERE seq = ?');
    for (const [seq, us] of entries) stmt.run(us, seq);
  }

  assignBatch(firstSeq: number, lastSeq: number, batchIndex: bigint) {
    this.db.prepare('UPDATE transactions SET batch_index = ? WHERE seq BETWEEN ? AND ?').run(Number(batchIndex), firstSeq, lastSeq);
  }

  countTxs(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as Row).c);
  }

  /** Últimas transacciones de toda la L2 (feed del explorer). */
  recentTxs(limit = 25): TxRecord[] {
    const rows = this.db.prepare('SELECT * FROM transactions ORDER BY seq DESC LIMIT ?').all(Math.min(limit, 200)) as Row[];
    return rows.map(rowToTx);
  }

  /**
   * Métricas de la ventana reciente. Las latencias salen del log, no de una estimación:
   * es el tiempo que el secuenciador tardó en confirmar cada pago.
   */
  statsSince(sinceMs: number): { count: number; latencyP50Us: number; latencyP99Us: number; byType: Record<string, number> } {
    const rows = this.db
      .prepare('SELECT type, latency_us FROM transactions WHERE created_at >= ? ORDER BY latency_us ASC')
      .all(sinceMs) as Row[];
    const byType: Record<string, number> = {};
    for (const r of rows) byType[String(r.type)] = (byType[String(r.type)] ?? 0) + 1;
    const lat = rows.map((r) => Number(r.latency_us)).sort((a, b) => a - b);
    const pick = (q: number): number => (lat.length === 0 ? 0 : lat[Math.min(lat.length - 1, Math.floor(lat.length * q))]!);
    return { count: rows.length, latencyP50Us: pick(0.5), latencyP99Us: pick(0.99), byType };
  }

  // ---- batches ----
  insertBatch(b: BatchRecord) {
    this.db
      .prepare(
        `INSERT INTO batches(batch_index, prev_state_root, new_state_root, withdrawals_root, tx_count, deposit_cursor, tx_data_hash, tx_data,
           first_seq, last_seq, status, l1_tx_hash, commit_ledger, sealed_at, committed_at, finalized_at, attempts, last_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Number(b.index), b.prevStateRoot, b.newStateRoot, b.withdrawalsRoot, b.txCount, Number(b.depositCursor), b.txDataHash, b.txData,
        b.firstSeq, b.lastSeq, b.status, b.l1TxHash, b.commitLedger, b.sealedAt, b.committedAt, b.finalizedAt, b.attempts, b.lastAttemptAt, b.lastError,
      );
  }

  getBatch(index: bigint): BatchRecord | undefined {
    const row = this.db.prepare('SELECT * FROM batches WHERE batch_index = ?').get(Number(index)) as Row | undefined;
    return row ? rowToBatch(row) : undefined;
  }

  lastBatch(): BatchRecord | undefined {
    const row = this.db.prepare('SELECT * FROM batches ORDER BY batch_index DESC LIMIT 1').get() as Row | undefined;
    return row ? rowToBatch(row) : undefined;
  }

  listBatches(limit = 50, offset = 0): BatchRecord[] {
    const rows = this.db.prepare('SELECT * FROM batches ORDER BY batch_index DESC LIMIT ? OFFSET ?').all(limit, offset) as Row[];
    return rows.map(rowToBatch);
  }

  batchesByStatus(status: BatchStatus): BatchRecord[] {
    const rows = this.db.prepare('SELECT * FROM batches WHERE status = ? ORDER BY batch_index ASC').all(status) as Row[];
    return rows.map(rowToBatch);
  }

  markBatchAttempt(index: bigint, at: number, error: string | null) {
    this.db
      .prepare('UPDATE batches SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE batch_index = ?')
      .run(at, error, Number(index));
  }

  markBatchCommitted(index: bigint, l1TxHash: string, commitLedger: number, at: number) {
    this.db
      .prepare(`UPDATE batches SET status = 'committed', l1_tx_hash = ?, commit_ledger = ?, committed_at = ?, last_error = NULL WHERE batch_index = ?`)
      .run(l1TxHash, commitLedger, at, Number(index));
  }

  markBatchFinalized(index: bigint, at: number) {
    this.db.prepare(`UPDATE batches SET status = 'finalized', finalized_at = ? WHERE batch_index = ?`).run(at, Number(index));
  }

  // ---- withdrawals ----
  insertWithdrawal(w: WithdrawalRecord) {
    this.db
      .prepare('INSERT INTO withdrawals(tx_id, batch_index, w_index, recipient, token, amount) VALUES (?, ?, ?, ?, ?, ?)')
      .run(w.txId, Number(w.batchIndex), w.wIndex, w.recipient, w.token, w.amount);
  }

  getWithdrawal(txId: string): WithdrawalRecord | undefined {
    const row = this.db.prepare('SELECT * FROM withdrawals WHERE tx_id = ?').get(txId) as Row | undefined;
    return row ? rowToWithdrawal(row) : undefined;
  }

  withdrawalsForBatch(index: bigint): WithdrawalRecord[] {
    const rows = this.db.prepare('SELECT * FROM withdrawals WHERE batch_index = ? ORDER BY w_index ASC').all(Number(index)) as Row[];
    return rows.map(rowToWithdrawal);
  }

  // ---- deposits ----
  insertDeposit(d: DepositRecord) {
    this.db
      .prepare('INSERT INTO deposits(deposit_index, from_account, token, amount, l2_recipient, ledger, l1_tx_hash, tx_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(Number(d.index), d.from, d.token, d.amount, d.l2Recipient, d.ledger, d.l1TxHash, d.txId);
  }

  listDeposits(limit = 50): DepositRecord[] {
    const rows = this.db.prepare('SELECT * FROM deposits ORDER BY deposit_index DESC LIMIT ?').all(limit) as Row[];
    return rows.map((r) => ({
      index: BigInt(r.deposit_index as number),
      from: String(r.from_account),
      token: String(r.token),
      amount: String(r.amount),
      l2Recipient: String(r.l2_recipient),
      ledger: Number(r.ledger),
      l1TxHash: String(r.l1_tx_hash),
      txId: String(r.tx_id),
    }));
  }

  // ---- snapshots ----
  saveSnapshot(lastSeq: number, stateRoot: string, json: string, at: number) {
    this.db
      .prepare(
        `INSERT INTO snapshots(id, last_seq, state_root, json, saved_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seq = excluded.last_seq, state_root = excluded.state_root, json = excluded.json, saved_at = excluded.saved_at`,
      )
      .run(lastSeq, stateRoot, json, at);
  }

  loadSnapshot(): { lastSeq: number; stateRoot: string; json: string } | undefined {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = 1').get() as Row | undefined;
    return row ? { lastSeq: Number(row.last_seq), stateRoot: String(row.state_root), json: String(row.json) } : undefined;
  }

  // ---- health ----
  logHealth(h: HealthLogRecord) {
    this.db
      .prepare(
        'INSERT INTO health_log(at, status, latest_ledger, ledger_age_sec, fee_p50, fee_p90, ok_endpoints, total_endpoints, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(h.at, h.status, h.latestLedger, h.ledgerAgeSec, h.feeP50, h.feeP90, h.okEndpoints, h.totalEndpoints, h.reason);
  }

  recentHealth(limit = 100): HealthLogRecord[] {
    const rows = this.db.prepare('SELECT * FROM health_log ORDER BY id DESC LIMIT ?').all(limit) as Row[];
    return rows.map((r) => ({
      at: Number(r.at),
      status: String(r.status),
      latestLedger: r.latest_ledger === null ? null : Number(r.latest_ledger),
      ledgerAgeSec: r.ledger_age_sec === null ? null : Number(r.ledger_age_sec),
      feeP50: r.fee_p50 === null ? null : Number(r.fee_p50),
      feeP90: r.fee_p90 === null ? null : Number(r.fee_p90),
      okEndpoints: Number(r.ok_endpoints),
      totalEndpoints: Number(r.total_endpoints),
      reason: String(r.reason),
    }));
  }
}

function rowToTx(r: Row): TxRecord {
  return {
    seq: Number(r.seq),
    id: String(r.id),
    type: r.type as TxRecord['type'],
    from: r.from_account === null ? null : String(r.from_account),
    to: r.to_account === null ? null : String(r.to_account),
    token: String(r.token),
    amount: String(r.amount),
    json: String(r.json),
    batchIndex: r.batch_index === null ? null : BigInt(r.batch_index as number),
    createdAt: Number(r.created_at),
    latencyUs: Number(r.latency_us),
  };
}

function rowToBatch(r: Row): BatchRecord {
  return {
    index: BigInt(r.batch_index as number),
    prevStateRoot: String(r.prev_state_root),
    newStateRoot: String(r.new_state_root),
    withdrawalsRoot: String(r.withdrawals_root),
    txCount: Number(r.tx_count),
    depositCursor: BigInt(r.deposit_cursor as number),
    txDataHash: String(r.tx_data_hash),
    txData: new Uint8Array(r.tx_data as Uint8Array),
    firstSeq: Number(r.first_seq),
    lastSeq: Number(r.last_seq),
    status: r.status as BatchStatus,
    l1TxHash: r.l1_tx_hash === null ? null : String(r.l1_tx_hash),
    commitLedger: r.commit_ledger === null ? null : Number(r.commit_ledger),
    sealedAt: Number(r.sealed_at),
    committedAt: r.committed_at === null ? null : Number(r.committed_at),
    finalizedAt: r.finalized_at === null ? null : Number(r.finalized_at),
    attempts: Number(r.attempts),
    lastAttemptAt: r.last_attempt_at === null ? null : Number(r.last_attempt_at),
    lastError: r.last_error === null ? null : String(r.last_error),
  };
}

function rowToWithdrawal(r: Row): WithdrawalRecord {
  return {
    txId: String(r.tx_id),
    batchIndex: BigInt(r.batch_index as number),
    wIndex: Number(r.w_index),
    recipient: String(r.recipient),
    token: String(r.token),
    amount: String(r.amount),
  };
}
