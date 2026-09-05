/** Cliente mínimo del secuenciador para la landing (solo lectura). */
export const SEQUENCER_URL =
  import.meta.env.VITE_SEQUENCER_URL ?? 'https://stellar-flash-sequencer.onrender.com';

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
  network: { bridgeContractId: string; l1Mode: string; passphrase: string };
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
  l1TxHash: string | null; commitLedger: number | null;
  sealedAt: number; committedAt: number | null; finalizedAt: number | null;
}

export interface Stats {
  windowSec: number;
  l2: { txs: number; txsPerSec: number; latencyP50Us: number; latencyP99Us: number;
        byType: Record<string, number>; totalTxs: number; accounts: number };
  l1: { batchesTotal: string; batchesCommitted: number; avgSealToCommitMs: number | null; lastBatch: BatchRow | null };
}

export interface HealthPoint { at: number; status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; latestLedger: number; ledgerAgeSec: number; feeP90: number }

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
export const fetchL1History = (signal?: AbortSignal) =>
  get<{ recent: HealthPoint[] }>(`/v1/l1/history`, signal).then((r) => r.recent);
