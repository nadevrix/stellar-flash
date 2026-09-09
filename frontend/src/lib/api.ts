/** Cliente mínimo del secuenciador para la landing (solo lectura). */
export const SEQUENCER_URL =
  import.meta.env.VITE_SEQUENCER_URL ?? 'https://stellar-flash-sequencer.onrender.com';

export const XLM_TESTNET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const XLM_MAINNET = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

export interface Health {
  status: string;
  l2: {
    seq: number; accounts: number; nextBatch: string; stateRoot: string;
    pendingTxs: number; uptimeSec: number;
    lastBatch: null | { index: string; status: string; txCount: number; l1TxHash: string | null; commitLedger: number | null };
  };
  l1: {
    status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
    reason: string; latestLedger: number; ledgerAgeSec: number;
    feeP50: number; feeP90: number; surge: boolean;
  };
  network: { bridgeContractId: string; l1Mode: string; passphrase: string; allowedTokens?: string[]; sequencerAccount?: string | null; onramp?: { enabled: boolean; address: string; horizonUrl: string; minAmount: string; token?: string; autoclaim: boolean } | null };
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${SEQUENCER_URL}/v1/health`, { signal });
  if (!res.ok) throw new Error(`sequencer HTTP ${res.status}`);
  return res.json() as Promise<Health>;
}

export interface TxRow {
  id: string; seq: number; type: 'deposit' | 'transfer' | 'withdraw';
  from: string | null; to: string | null; token: string; amount: string;
  batchIndex: string | null; createdAt: number; latencyUs: number;
}

export interface BatchRow {
  index: string; status: 'sealed' | 'committed' | 'finalized';
  txCount: number; txDataBytes: number; newStateRoot: string;
  prevStateRoot?: string; withdrawalsRoot?: string; txDataHash?: string;
  l1TxHash: string | null; commitLedger: number | null;
  sealedAt: number; committedAt: number | null; finalizedAt: number | null;
  txData?: string;
}

export interface Stats {
  windowSec: number;
  l2: {
    txs: number; txsPerSec: number; latencyP50Us: number; latencyP99Us: number;
    byType: Record<string, number>; totalTxs: number; accounts: number;
    lifetime?: { txs: number; latencyP50Us: number; latencyP99Us: number };
  };
  l1: { batchesTotal: string; batchesCommitted: number; avgSealToCommitMs: number | null; lastBatch: BatchRow | null };
}

export interface HealthPoint {
  at: number;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latestLedger: number | null;
  ledgerAgeSec: number | null;
  feeP90: number | null;
}

const get = async <T,>(path: string, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(`${SEQUENCER_URL}${path}`, { signal });
  if (!res.ok) throw new Error(`sequencer HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

export const fetchTxs = (limit = 25, signal?: AbortSignal) =>
  get<{ transactions: TxRow[] }>(`/v1/transactions?limit=${limit}`, signal).then((r) => r.transactions);
export const fetchBatches = (limit = 12, signal?: AbortSignal) =>
  get<{ batches: BatchRow[] }>(`/v1/batches?limit=${limit}`, signal).then((r) => r.batches);
export const fetchStats = (windowSec = 60, signal?: AbortSignal) =>
  get<Stats>(`/v1/stats?window=${windowSec}`, signal);

export const fetchL1History = async (signal?: AbortSignal): Promise<HealthPoint[]> => {
  const r = await get<{ recent?: HealthPoint[]; history?: HealthPoint[] }>(`/v1/l1/history`, signal);
  if (r.recent && r.recent.length > 0) return r.recent;
  // SQLite history llega newest-first; la tira se lee de izquierda (viejo) a derecha (nuevo).
  return [...(r.history ?? [])].reverse();
};

export interface AccountBalance { token: string; balance: string; nonce: string }
export interface AccountTx {
  id: string; seq: number; type: 'deposit' | 'transfer' | 'withdraw';
  from: string | null; to: string | null; token: string; amount: string;
  batchIndex: string | null; createdAt: number;
}
export interface AccountView {
  account: string; balances: AccountBalance[]; transactions: AccountTx[];
}

export interface TxDetail {
  id: string; seq: number; type: string; createdAt: number; latencyUs: number;
  finality: { l2: string; l1: string };
  batch: BatchRow | null;
}

export interface TokenMeta { id: string; symbol: string; decimals: number }

const KNOWN: Record<string, TokenMeta> = {
  [XLM_TESTNET]: { id: XLM_TESTNET, symbol: 'XLM', decimals: 7 },
  [XLM_MAINNET]: { id: XLM_MAINNET, symbol: 'XLM', decimals: 7 },
};

function metaFor(id: string): TokenMeta {
  return KNOWN[id] ?? { id, symbol: 'SAC', decimals: 7 };
}

/** `/v1/tokens` faltó en un deploy de Render; caemos a `/v1/assets` y luego a health. */
export async function fetchTokens(signal?: AbortSignal): Promise<{ tokens: TokenMeta[] }> {
  for (const path of ['/v1/tokens', '/v1/assets'] as const) {
    try {
      const r = await get<{ tokens: TokenMeta[] }>(path, signal);
      if (r.tokens?.length) return r;
    } catch {
      /* siguiente fallback */
    }
  }
  const h = await fetchHealth(signal);
  const ids = h.network.allowedTokens?.length ? h.network.allowedTokens : [XLM_TESTNET];
  return { tokens: ids.map(metaFor) };
}

export const fetchAccount = (address: string, limit = 50, signal?: AbortSignal) =>
  get<AccountView>(`/v1/accounts/${address}?limit=${limit}`, signal);

export const fetchTx = (id: string, signal?: AbortSignal) =>
  get<TxDetail>(`/v1/transactions/${id}`, signal);

export const fetchBatch = (index: string, withData = false, signal?: AbortSignal) =>
  get<{ batch: BatchRow & { txData?: string }; withdrawals: { txId: string; recipient: string; amount: string }[] }>(
    `/v1/batches/${index}${withData ? '?data=1' : ''}`, signal);
