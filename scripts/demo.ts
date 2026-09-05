/**
 * Demo end-to-end de Stellar Flash con una L1 simulada (sin red):
 *   node scripts/demo.ts
 *
 * Guion (el mismo que se usa en el pitch, ver docs/11-pitch.md):
 *  1. Depósito L1 → saldo en Flash.
 *  2. Ráfaga de pagos con finalidad instantánea (latencias en µs).
 *  3. Lote publicado en Stellar: N pagos = 1 transacción L1.
 *  4. Stellar RPC "se cae" (como el 20-feb-2026) → Flash sigue confirmando; settlement en HOLD.
 *  5. Surge pricing → lotes sin retiros se difieren; un retiro fuerza publicación con fee alta.
 *  6. Stellar vuelve → lotes publicados en orden, raíces encadenadas, verificación independiente.
 *  7. Prueba Merkle de retiro, verificada con el mismo algoritmo del contrato.
 */
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { FlashState, decodeBatchData, domainSeparator, fromHex, replayBatch, signTx, toHex, verifyProof, withdrawalLeaf } from '../protocol/src/index.ts';
import { Sequencer } from '../sequencer/src/core/sequencer.ts';
import { Store } from '../sequencer/src/db/store.ts';
import { SettlementEngine, type EngineEvent } from '../sequencer/src/settlement/engine.ts';
import { L1HealthMonitor } from '../sequencer/src/settlement/health.ts';
import { MockL1Client } from '../sequencer/src/settlement/l1.ts';

const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // SAC de XLM en testnet
const BRIDGE = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'; // placeholder de puente
const STROOP = 10_000_000n;

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m' };
const h = (s: string) => console.log(`\n${c.bold}${c.cyan}${s}${c.reset}`);
const ok = (s: string) => console.log(`  ${c.green}✔${c.reset} ${s}`);
const info = (s: string) => console.log(`  ${c.dim}·${c.reset} ${s}`);
const warn = (s: string) => console.log(`  ${c.yellow}!${c.reset} ${s}`);
const fmt = (n: bigint) => `${(Number(n) / 1e7).toLocaleString('es', { maximumFractionDigits: 7 })} XLM`;
const pct = (arr: number[], p: number) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))];

let clock = Date.now();
const domain = domainSeparator({ networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE });
const seqr = Sequencer.open({ domain, store: new Store(':memory:'), maxBatchBytes: 60_000, maxBatchTxs: 250 });
const l1 = new MockL1Client({ challengePeriodLedgers: 20, now: () => clock });
const monitor = new L1HealthMonitor(l1, { healthyLedgerAgeSec: 15, downLedgerAgeSec: 60, surgeFeeStroops: 2_000 }, 1_000);
const events: EngineEvent[] = [];
const engine = new SettlementEngine(seqr, l1, monitor, { minInclusionFeeStroops: 200, maxInclusionFeeStroops: 1_000_000, maxDeferMs: 60_000, retryBaseMs: 1_000, sealIntervalMs: 0, challengePeriodLedgers: 20, depositScanStartLedger: 0 }, (e) => {
  events.push(e);
  const color = e.kind === 'commit' || e.kind === 'finalized' ? c.green : e.kind === 'hold' || e.kind === 'commit_failed' ? c.red : e.kind === 'defer' ? c.yellow : c.dim;
  console.log(`    ${color}[${e.kind}]${c.reset} ${e.message}`);
});
const tick = async (ms = 0) => {
  clock += ms;
  if (ms > 0) l1.advanceLedgers(Math.max(1, Math.round(ms / 5_000)));
  return engine.tick(clock);
};

const alice = Keypair.random();
const merchant = Keypair.random();
const users = Array.from({ length: 5 }, () => Keypair.random());
const nonces = new Map<string, bigint>();
const pay = (from: Keypair, to: string, amount: bigint) => {
  const n = nonces.get(from.publicKey()) ?? 0n;
  const r = seqr.submit(signTx({ type: 'transfer', from: from.publicKey(), to, token: XLM, amount, nonce: n }, from, domain));
  nonces.set(from.publicKey(), n + 1n);
  return r;
};

console.log(`${c.bold}${c.magenta}⚡ Stellar Flash · demo end-to-end (L1 simulada)${c.reset}`);
console.log(`${c.dim}dominio de firma: ${toHex(domain).slice(0, 16)}… · puente: ${BRIDGE.slice(0, 8)}… · token: XLM (SAC)${c.reset}`);

h('1) Depósito L1 → L2');
l1.deposit(alice.publicKey(), XLM, 1_000n * STROOP, alice.publicKey());
await tick();
ok(`alice depositó ${fmt(1_000n * STROOP)} en el puente (ledger ${l1.latestLedger}); acreditado en Flash: ${fmt(seqr.state.get(alice.publicKey(), XLM).balance)}`);

h('2) Ráfaga de pagos en Flash (finalidad instantánea)');
for (const u of users) pay(alice, u.publicKey(), 50n * STROOP);
const lat: number[] = [];
const t0 = performance.now();
for (let i = 0; i < 200; i++) {
  const u = users[i % users.length];
  lat.push(pay(u, merchant.publicKey(), STROOP / 10n).latencyUs);
}
const elapsed = performance.now() - t0;
ok(`200 pagos confirmados en ${elapsed.toFixed(0)} ms → ${(200_000 / elapsed).toFixed(0)} tx/s en un solo hilo`);
ok(`latencia por pago: p50 ${pct(lat, 50)} µs · p99 ${pct(lat, 99)} µs (en Stellar L1: ~5 000 000 µs por ledger)`);
info(`saldo del comercio: ${fmt(seqr.state.get(merchant.publicKey(), XLM).balance)} · nonces por cuenta evitan replay`);

h('3) Publicación del lote en Stellar (L1 sana)');
await tick(5_000);
const b1 = seqr.store.getBatch(1n)!;
ok(`lote #1: ${b1.txCount} txs en ${b1.txData.length} bytes → 1 sola transacción Soroban en L1 (tx ${b1.l1TxHash?.slice(0, 12)}…)`);
info(`raíz de estado ${b1.newStateRoot.slice(0, 20)}… · raíz de retiros ${b1.withdrawalsRoot.slice(0, 20)}… · hash de datos ${b1.txDataHash.slice(0, 20)}…`);
info(`en L1 clásica esos ${b1.txCount} pagos serían ${b1.txCount} operaciones (~${b1.txCount * 100} stroops mínimos y ${b1.txCount} huecos de los 1000 por ledger)`);

h('4) 💥 Stellar RPC se cae (como el incidente del 20-feb-2026)');
l1.mode = 'down';
const t1 = performance.now();
for (let i = 0; i < 300; i++) pay(users[i % users.length], merchant.publicKey(), STROOP / 100n);
ok(`300 pagos más confirmados en ${(performance.now() - t1).toFixed(0)} ms mientras la L1 no responde`);
await tick(5_000);
warn(`salud L1: ${monitor.current().status} — ${monitor.current().reason}`);
warn(`decisión de settlement: ${engine.lastPolicyDecision?.action} — ${engine.lastPolicyDecision?.reason}`);
info(`lotes sellados esperando: ${seqr.store.batchesByStatus('sealed').length} · la experiencia del usuario no cambió`);

h('5) Surge pricing en Stellar: publicar es caro → Flash difiere lo no urgente');
l1.mode = 'degraded';
l1.advanceLedgers(1);
await tick(5_000);
info(`salud L1: ${monitor.current().status} (fee p90 ${monitor.current().feeP90} stroops) → ${engine.lastPolicyDecision?.action}`);
const wd = seqr.submit(signTx({ type: 'withdraw', from: merchant.publicKey(), token: XLM, amount: 5n * STROOP, nonce: 0n, l1Recipient: merchant.publicKey() }, merchant, domain));
info(`el comercio pide retirar ${fmt(5n * STROOP)} a su cuenta Stellar (tx ${wd.id.slice(0, 12)}…): el lote pasa a ser urgente`);
await tick(61_000); // supera maxDeferMs → lotes urgentes
await tick(5_000);
ok(`lotes publicados durante surge pagando fee alta (solo cuando hacía falta): ${l1.batches.length} en el contrato`);

h('6) Stellar vuelve a la normalidad');
l1.mode = 'healthy';
for (let i = 0; i < 40; i++) pay(users[i % users.length], merchant.publicKey(), STROOP / 100n);
await tick(5_000);
await tick(5_000);
const chain = l1.batches;
const linked = chain.every((b, i) => i === 0 || b.prevStateRoot === chain[i - 1].newStateRoot);
ok(`${chain.length} lotes en el contrato, raíces encadenadas correctamente: ${linked ? 'sí' : 'NO'}`);

h('7) Verificación independiente (cualquiera puede auditar al secuenciador)');
const verifier = new FlashState(domain);
let verified = 0;
for (const b of chain) {
  const res = replayBatch(verifier, b.batchIndex, decodeBatchData(b.txData));
  if (!res.ok || toHex(res.newStateRoot) !== b.newStateRoot || toHex(res.withdrawalsRoot) !== b.withdrawalsRoot) throw new Error(`lote #${b.batchIndex} NO verifica`);
  verified++;
}
ok(`re-ejecutados ${verified} lotes desde los datos publicados en L1 → mismas raíces que el contrato (0 fraudes)`);

h('8) Retiro L2 → L1 con prueba Merkle');
const proof = seqr.withdrawalProof(wd.id)!;
const leaf = withdrawalLeaf(BigInt(proof.batchIndex), proof.wIndex, merchant.publicKey(), XLM, 5n * STROOP);
const valid = verifyProof(leaf, proof.wIndex, proof.proof.map(fromHex), fromHex(proof.withdrawalsRoot));
ok(`prueba de ${proof.proof.length} hermanos para el retiro en lote #${proof.batchIndex} · verifica localmente: ${valid}`);
info(`estado del lote: ${proof.batchStatus} → tras ${20} ledgers de desafío se llama withdraw(...) en el contrato`);
await tick(20 * 5_000);
ok(`lote #${proof.batchIndex} finalizado: reclamable en L1 = ${seqr.withdrawalProof(wd.id)!.claimable}`);

h('Resumen');
const total = seqr.store.countTxs();
console.log(`  txs L2: ${total} · lotes: ${chain.length} · txs L1 usadas: ${chain.length} · compresión: ${(total / chain.length).toFixed(0)} pagos por tx L1`);
console.log(`  eventos de settlement: ${events.filter((e) => e.kind === 'commit').length} commits, ${events.filter((e) => e.kind === 'hold').length} hold, ${events.filter((e) => e.kind === 'defer').length} defer, ${events.filter((e) => e.kind === 'commit_failed').length} fallos reintentados`);
console.log(`  ${c.dim}Nada de esto requiere confiar en el secuenciador: fondos en el contrato, salidas con prueba Merkle, datos del lote en L1.${c.reset}\n`);
