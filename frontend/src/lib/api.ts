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
