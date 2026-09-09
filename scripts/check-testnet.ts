/**
 * Sonda el deploy público de testnet. No necesita secretos.
 *   npm run check:testnet
 */
import { FlashState, decodeBatchData, domainSeparator, replayBatch, sha256, toHex } from '../protocol/src/index.ts';

const APP = process.env.FLASH_APP_URL ?? 'https://stellar-flash.onrender.com';
const API = process.env.FLASH_URL ?? 'https://stellar-flash-sequencer.onrender.com';

type Issue = { ok: boolean; name: string; detail: string };

const get = async (url: string) => {
  const r = await fetch(url);
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text };
};

const issues: Issue[] = [];
const check = (ok: boolean, name: string, detail: string) => {
  issues.push({ ok, name, detail });
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name} — ${detail}`);
};

const health = await get(`${API}/v1/health`);
check(health.status === 200, 'GET /v1/health', `HTTP ${health.status}`);
const h = health.json as {
  l1?: { status?: string; endpoints?: unknown[] };
  network?: { l1Mode?: string; bridgeContractId?: string; allowedTokens?: string[]; passphrase?: string };
} | null;
if (h) {
  check(h.l1?.status === 'HEALTHY' || h.l1?.status === 'DEGRADED', 'L1 status', String(h.l1?.status));
  check(h.network?.l1Mode === 'rpc', 'L1_MODE=rpc', String(h.network?.l1Mode));
  const n = h.l1?.endpoints?.length ?? 0;
  check(n >= 2, 'RPC failover', n >= 2 ? `${n} endpoints` : `${n} endpoint — pega RPC_URLS del render.yaml en el dashboard de Render`);
  check(!!h.network?.bridgeContractId?.startsWith('C'), 'bridge contract', h.network?.bridgeContractId ?? 'missing');
  const onrampAddr = (h.network as { onramp?: { address?: string; enabled?: boolean } } | undefined)?.onramp?.address;
  check(!!onrampAddr?.startsWith('G'), 'onramp address', onrampAddr ?? 'missing — el secuenciador debe anunciar network.onramp');
}

const tokens = await get(`${API}/v1/tokens`);
const assets = await get(`${API}/v1/assets`);
check(tokens.status === 200 || assets.status === 200, 'GET /v1/tokens|/v1/assets',
  tokens.status === 200 ? 'tokens 200' : assets.status === 200 ? 'assets 200 (tokens 404 — redespliega el secuenciador)' : `tokens ${tokens.status} assets ${assets.status}`);

const stats = await get(`${API}/v1/stats`);
check(stats.status === 200, 'GET /v1/stats', `HTTP ${stats.status}`);

const txs = await get(`${API}/v1/transactions?limit=1`);
check(txs.status === 200, 'GET /v1/transactions', `HTTP ${txs.status}`);

if (h?.network?.passphrase && h.network.bridgeContractId) {
  try {
    const list = await get(`${API}/v1/batches?limit=200`);
    const batches = ((list.json as { batches?: { index: string }[] } | null)?.batches ?? [])
      .slice()
      .sort((a, b) => Number(a.index) - Number(b.index));
    const domain = domainSeparator({ networkPassphrase: h.network.passphrase, bridgeContractId: h.network.bridgeContractId });
    const allow = h.network.allowedTokens ?? [];
    const state = new FlashState(domain, { allowedTokens: allow.length ? new Set(allow) : undefined });
    let failed: string | null = null;
    for (const header of batches) {
      const raw = await get(`${API}/v1/batches/${header.index}?data=1`);
      const batch = (raw.json as { batch?: { index: string; txData?: string; txDataHash: string; prevStateRoot: string; newStateRoot: string; withdrawalsRoot: string } }).batch;
      if (!batch?.txData) { failed = `#${header.index} sin txData`; break; }
      const bytes = Uint8Array.from(Buffer.from(batch.txData, 'base64'));
      if (toHex(sha256(bytes)) !== batch.txDataHash) { failed = `#${header.index} hash`; break; }
      if (state.rootHex() !== batch.prevStateRoot) { failed = `#${header.index} prevRoot`; break; }
      const res = replayBatch(state, BigInt(batch.index), decodeBatchData(bytes));
      if (!res.ok || toHex(res.newStateRoot) !== batch.newStateRoot || toHex(res.withdrawalsRoot) !== batch.withdrawalsRoot) {
        failed = `#${header.index} ${res.error ?? 'root mismatch'}`;
        break;
      }
    }
    check(!failed, 'replay batches from genesis', failed ?? `${batches.length} batches, root ${state.rootHex().slice(0, 16)}…`);
  } catch (e) {
    check(false, 'replay batches from genesis', e instanceof Error ? e.message : String(e));
  }
}

for (const path of ['/', '/bridge', '/explorer', '/developers', '/batches/21']) {
  const r = await get(`${APP}${path}`);
  check(r.status === 200 && r.text.includes('<div id="root">'), `app ${path}`, `HTTP ${r.status}`);
}

const failedN = issues.filter((i) => !i.ok);
console.log('');
if (failedN.length === 0) {
  console.log('testnet público: ok');
  process.exit(0);
}
console.log(`${failedN.length} problema(s). Checklist: docs/11-product-and-deployment.md §10`);
process.exit(1);
