/** Re-ejecuta lotes en el navegador y compara raíces con lo publicado. */
import { FlashState, decodeBatchData, domainSeparator, replayBatch, sha256, toHex, txId, type L2Tx } from '@flash/protocol';
import { fetchBatch, fetchBatches, fetchHealth } from './api.ts';

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeBatchTxs(txDataB64: string): L2Tx[] {
  return decodeBatchData(b64ToBytes(txDataB64));
}

export interface VerifyOk {
  ok: true;
  batches: number;
  accounts: number;
  stateRoot: string;
}

export interface VerifyFail {
  ok: false;
  error: string;
  batchIndex?: string;
}

export async function verifyFromGenesis(upToIndex: string): Promise<VerifyOk | VerifyFail> {
  const health = await fetchHealth();
  const domain = domainSeparator({
    networkPassphrase: health.network.passphrase,
    bridgeContractId: health.network.bridgeContractId,
  });
  const allow = health.network.allowedTokens ?? [];
  const state = new FlashState(domain, { allowedTokens: allow.length ? new Set(allow) : undefined });

  const headers = (await fetchBatches(200))
    .filter((b) => Number(b.index) <= Number(upToIndex))
    .sort((a, b) => Number(a.index) - Number(b.index));

  if (headers.length === 0) return { ok: false, error: 'No batches to replay.' };

  for (const header of headers) {
    const { batch } = await fetchBatch(header.index, true);
    if (!batch.txData) return { ok: false, error: `Batch #${batch.index} has no txData.`, batchIndex: batch.index };

    const bytes = b64ToBytes(batch.txData);
    const hash = toHex(sha256(bytes));
    if (hash !== batch.txDataHash) {
      return { ok: false, error: `txData hash mismatch on batch #${batch.index}.`, batchIndex: batch.index };
    }
    if (state.rootHex() !== batch.prevStateRoot) {
      return { ok: false, error: `prevStateRoot mismatch on batch #${batch.index}.`, batchIndex: batch.index };
    }

    let txs: L2Tx[];
    try {
      txs = decodeBatchData(bytes);
    } catch (e) {
      return { ok: false, error: `Could not decode batch #${batch.index}: ${e instanceof Error ? e.message : String(e)}`, batchIndex: batch.index };
    }

    const res = replayBatch(state, BigInt(batch.index), txs);
    if (!res.ok) {
      return { ok: false, error: res.error ?? `Invalid tx in batch #${batch.index}.`, batchIndex: batch.index };
    }
    if (toHex(res.newStateRoot) !== batch.newStateRoot) {
      return { ok: false, error: `newStateRoot mismatch on batch #${batch.index}.`, batchIndex: batch.index };
    }
    if (toHex(res.withdrawalsRoot) !== batch.withdrawalsRoot) {
      return { ok: false, error: `withdrawalsRoot mismatch on batch #${batch.index}.`, batchIndex: batch.index };
    }
  }

  return { ok: true, batches: headers.length, accounts: state.size, stateRoot: state.rootHex() };
}

export function idForTx(tx: L2Tx, passphrase: string, bridgeContractId: string): string {
  return txId(tx, domainSeparator({ networkPassphrase: passphrase, bridgeContractId }));
}
