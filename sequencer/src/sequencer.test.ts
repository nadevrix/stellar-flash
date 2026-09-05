import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { FlashError, FlashState, decodeBatchData, domainSeparator, fromHex, replayBatch, signTx, stateLeaf, toHex, verifyProof, withdrawalLeaf } from '../../protocol/src/index.ts';
import { Sequencer } from './core/sequencer.ts';
import { Store } from './db/store.ts';
import { SettlementEngine, type EngineEvent } from './settlement/engine.ts';
import { L1HealthMonitor, evaluateHealth, type HealthSnapshot } from './settlement/health.ts';
import { MockL1Client } from './settlement/l1.ts';
import { decideSettlement } from './settlement/policy.ts';
import { createApiServer } from './api/server.ts';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const BRIDGE = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const DOMAIN = domainSeparator({ networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE });
const TH = { healthyLedgerAgeSec: 15, downLedgerAgeSec: 60, surgeFeeStroops: 2_000 };
const POLICY = { minInclusionFeeStroops: 200, maxInclusionFeeStroops: 1_000_000, maxDeferMs: 60_000, retryBaseMs: 1_000 };

function newSequencer(store = new Store(':memory:')) {
  return Sequencer.open({ domain: DOMAIN, store, maxBatchBytes: 60_000, maxBatchTxs: 250, snapshotEvery: 3 });
}

function engineWith(seqr: Sequencer, l1: MockL1Client, log: EngineEvent[] = []) {
  const monitor = new L1HealthMonitor(l1, TH, 1_000);
  const engine = new SettlementEngine(seqr, l1, monitor, { ...POLICY, sealIntervalMs: 0, challengePeriodLedgers: 20, depositScanStartLedger: 0 }, (e) => log.push(e));
  return { engine, monitor, log };
}

test('secuenciador: depósito, transferencias instantáneas, sellado y persistencia/replay', () => {
  const store = new Store(':memory:');
  const seqr = newSequencer(store);
  const alice = Keypair.random();
  const bob = Keypair.random();

  const r0 = seqr.ingestDeposit({ index: 0n, from: alice.publicKey(), token: TOKEN, amount: 1_000n, l2Recipient: alice.publicKey(), ledger: 100, l1TxHash: 'aa'.repeat(32) });
  assert.equal(r0?.type, 'deposit');
  assert.equal(seqr.ingestDeposit({ index: 0n, from: alice.publicKey(), token: TOKEN, amount: 1_000n, l2Recipient: alice.publicKey(), ledger: 100, l1TxHash: 'aa'.repeat(32) }), null, 'idempotente');

  const t1 = signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 400n, nonce: 0n }, alice, DOMAIN);
  const r1 = seqr.submit(t1);
  assert.equal(r1.status, 'confirmed');
  assert.equal(r1.finality.l2, 'instant');
  assert.ok(r1.latencyUs < 50_000, `latencia ${r1.latencyUs}µs`);
  assert.throws(() => seqr.submit(t1), (e: unknown) => e instanceof FlashError && e.code === 'BAD_NONCE');

  const w = signTx({ type: 'withdraw', from: bob.publicKey(), token: TOKEN, amount: 150n, nonce: 0n, l1Recipient: bob.publicKey() }, bob, DOMAIN);
  const rw = seqr.submit(w);
  assert.ok(seqr.pendingHasWithdrawals);
  assert.equal(seqr.pendingCount, 3);

  const batch = seqr.sealBatch()!;
  assert.equal(batch.index, 0n);
  assert.equal(batch.txCount, 3);
  assert.equal(batch.prevStateRoot, toHex(new Uint8Array(32)));
  assert.equal(batch.newStateRoot, seqr.state.rootHex());
  assert.equal(batch.depositCursor, 1n);
  assert.equal(seqr.pendingCount, 0);
  assert.equal(seqr.sealBatch(), null);

  // Los datos publicados en L1 permiten re-derivar exactamente el mismo estado (verificabilidad)
  const txs = decodeBatchData(batch.txData);
  assert.equal(txs.length, 3);
  const replay = replayBatch(new FlashState(DOMAIN), 0n, txs);
  assert.ok(replay.ok);
  assert.equal(toHex(replay.newStateRoot), batch.newStateRoot);
  assert.equal(toHex(replay.withdrawalsRoot), batch.withdrawalsRoot);

  // Prueba de retiro verificable contra la raíz del lote
  const proof = seqr.withdrawalProof(rw.id)!;
  assert.equal(proof.wIndex, 0);
  assert.equal(proof.claimable, false);
  const leaf = withdrawalLeaf(0n, 0, bob.publicKey(), TOKEN, 150n);
  assert.ok(verifyProof(leaf, 0, proof.proof.map(fromHex), fromHex(batch.withdrawalsRoot)));

  // Prueba de saldo (escape hatch)
  const bp = seqr.balanceProof(alice.publicKey(), TOKEN);
  assert.equal(bp.balance, 600n);
  assert.ok(verifyProof(stateLeaf(alice.publicKey(), TOKEN, bp.balance, bp.nonce), bp.leafIndex, bp.proof, bp.root));

  // Segunda tanda sin sellar → reinicio del proceso → estado y pendientes se recuperan del log
  seqr.submit(signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 100n, nonce: 1n }, alice, DOMAIN));
  const reopened = newSequencer(store);
  assert.equal(reopened.state.rootHex(), seqr.state.rootHex());
  assert.equal(reopened.currentSeq, 4);
  assert.equal(reopened.pendingCount, 1);
  assert.equal(reopened.nextBatch, 1n);
  const b1 = reopened.sealBatch()!;
  assert.equal(b1.prevStateRoot, batch.newStateRoot);
  assert.equal(b1.txCount, 1);
});

test('salud L1: evaluación de sondas', () => {
  const now = 1_700_000_000_000;
  const nowSec = now / 1000;
  const ok = evaluateHealth([{ endpoint: 'a', ok: true, latencyMs: 50, latestLedger: 10, latestLedgerCloseTime: nowSec - 3, feeP50: 100, feeP90: 200 }], TH, now);
  assert.equal(ok.status, 'HEALTHY');
  const lag = evaluateHealth([{ endpoint: 'a', ok: true, latencyMs: 50, latestLedger: 10, latestLedgerCloseTime: nowSec - 30, feeP90: 200 }], TH, now);
  assert.equal(lag.status, 'DEGRADED');
  const surge = evaluateHealth([{ endpoint: 'a', ok: true, latencyMs: 50, latestLedger: 10, latestLedgerCloseTime: nowSec - 3, feeP90: 5_000 }], TH, now);
  assert.equal(surge.status, 'DEGRADED');
  assert.ok(surge.surge);
  const stale = evaluateHealth([{ endpoint: 'a', ok: true, latencyMs: 50, latestLedger: 10, latestLedgerCloseTime: nowSec - 120 }], TH, now);
  assert.equal(stale.status, 'DOWN');
  const down = evaluateHealth([{ endpoint: 'a', ok: false, latencyMs: 4000, error: 'timeout' }, { endpoint: 'b', ok: false, latencyMs: 4000, error: 'ECONNREFUSED' }], TH, now);
  assert.equal(down.status, 'DOWN');
  // Failover: elige el endpoint con ledger más reciente aunque otro falle
  const mixed = evaluateHealth([{ endpoint: 'a', ok: false, latencyMs: 4000, error: 'x' }, { endpoint: 'b', ok: true, latencyMs: 90, latestLedger: 12, latestLedgerCloseTime: nowSec - 4, feeP90: 100 }], TH, now);
  assert.equal(mixed.status, 'HEALTHY');
  assert.equal(mixed.bestEndpoint, 'b');
});

test('política de settlement', () => {
  const now = 1_000_000;
  const healthy: HealthSnapshot = { status: 'HEALTHY', at: now, latestLedger: 1, ledgerAgeSec: 3, feeP50: 100, feeP90: 200, surge: false, okEndpoints: 1, totalEndpoints: 1, bestEndpoint: 'a', reason: '', probes: [] };
  const degraded: HealthSnapshot = { ...healthy, status: 'DEGRADED', feeP90: 25_000, surge: true };
  const down: HealthSnapshot = { ...healthy, status: 'DOWN' };
  const fresh = { sealedAt: now - 1_000, hasWithdrawals: false, attempts: 0, lastAttemptAt: null };

  assert.equal(decideSettlement(healthy, fresh, now, POLICY).action, 'COMMIT');
  assert.equal(decideSettlement(healthy, fresh, now, POLICY).maxInclusionFeeStroops, 300); // 1.5 × p90
  assert.equal(decideSettlement(down, fresh, now, POLICY).action, 'HOLD');
  assert.equal(decideSettlement(degraded, fresh, now, POLICY).action, 'DEFER');
  const urgentW = decideSettlement(degraded, { ...fresh, hasWithdrawals: true }, now, POLICY);
  assert.equal(urgentW.action, 'COMMIT');
  assert.equal(urgentW.maxInclusionFeeStroops, 50_000); // 2 × p90
  const urgentOld = decideSettlement(degraded, { ...fresh, sealedAt: now - 61_000 }, now, POLICY);
  assert.equal(urgentOld.action, 'COMMIT');
  // Tope de fee
  assert.equal(decideSettlement({ ...degraded, feeP90: 900_000 }, { ...fresh, hasWithdrawals: true }, now, POLICY).maxInclusionFeeStroops, 1_000_000);
  // Backoff tras intentos
  assert.equal(decideSettlement(healthy, { ...fresh, attempts: 1, lastAttemptAt: now - 500 }, now, POLICY).action, 'DEFER');
  const retry = decideSettlement(healthy, { ...fresh, attempts: 1, lastAttemptAt: now - 5_000 }, now, POLICY);
  assert.equal(retry.action, 'COMMIT');
  assert.equal(retry.maxInclusionFeeStroops, 450); // escala 1.5× por intento
});

test('motor: Stellar se cae → Flash sigue confirmando; al volver, publica los lotes en orden', async () => {
  const seqr = newSequencer();
  const l1 = new MockL1Client({ challengePeriodLedgers: 20 });
  const { engine, log } = engineWith(seqr, l1);
  const alice = Keypair.random();
  const bob = Keypair.random();

  // Depósito en L1 → el motor lo detecta, lo acredita en L2 y (sealInterval=0) lo sella y publica en el mismo tick
  l1.deposit(alice.publicKey(), TOKEN, 10_000n, alice.publicKey());
  await engine.tick();
  assert.equal(seqr.state.get(alice.publicKey(), TOKEN).balance, 10_000n);
  assert.equal(l1.batches.length, 1);
  assert.equal(seqr.store.getBatch(0n)!.status, 'committed');

  // Lote 1 (transferencia) se publica con L1 sana
  seqr.submit(signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 1n, nonce: 0n }, alice, DOMAIN));
  await engine.tick();
  assert.equal(l1.batches.length, 2);
  assert.equal(seqr.store.getBatch(1n)!.status, 'committed');

  // Stellar "se cae" (RPC caído, como feb-2026)
  l1.mode = 'down';
  const t0 = performance.now();
  for (let n = 1n; n <= 50n; n++) {
    const r = seqr.submit(signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 2n, nonce: n }, alice, DOMAIN));
    assert.equal(r.status, 'confirmed');
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 2_000, `50 txs con L1 caída en ${elapsedMs.toFixed(1)}ms`);
  await engine.tick();
  assert.equal(engine.monitor.current().status, 'DOWN');
  assert.equal(engine.lastPolicyDecision?.action, 'HOLD');
  assert.equal(l1.batches.length, 2, 'no se intenta publicar con L1 caída');
  assert.equal(seqr.store.batchesByStatus('sealed').length, 1);

  // Más txs mientras sigue caída → otro lote sellado en cola
  seqr.submit(signTx({ type: 'withdraw', from: bob.publicKey(), token: TOKEN, amount: 10n, nonce: 0n, l1Recipient: bob.publicKey() }, bob, DOMAIN));
  await engine.tick();
  assert.equal(seqr.store.batchesByStatus('sealed').length, 2);

  // Stellar vuelve → se publican en orden (#2 y luego #3)
  l1.mode = 'healthy';
  l1.advanceLedgers(1);
  await engine.tick();
  await engine.tick();
  assert.equal(l1.batches.length, 4);
  assert.deepEqual(l1.batches.map((b) => b.batchIndex), [0n, 1n, 2n, 3n]);
  assert.equal(l1.batches[3].prevStateRoot, l1.batches[2].newStateRoot);
  assert.equal(seqr.store.batchesByStatus('sealed').length, 0);

  // Finalización tras el periodo de desafío
  l1.advanceLedgers(20);
  await engine.tick();
  assert.equal(seqr.store.getBatch(3n)!.status, 'finalized');
  assert.ok(log.some((e) => e.kind === 'hold'));
  assert.ok(log.some((e) => e.kind === 'finalized'));
});

test('motor: surge pricing difiere lotes sin retiros y publica urgentes con fee alta; TRY_AGAIN_LATER reintenta', async () => {
  // Reloj controlado: el mock y el motor comparten `clock` para simular el paso del tiempo sin dormir.
  let clock = Date.now();
  const seqr = newSequencer();
  const l1 = new MockL1Client({ now: () => clock });
  const { engine } = engineWith(seqr, l1);
  const alice = Keypair.random();
  const bob = Keypair.random();
  l1.deposit(alice.publicKey(), TOKEN, 1_000n, alice.publicKey());
  await engine.tick(clock); // lote #0 (depósito) publicado con L1 sana
  assert.equal(l1.commitCalls, 1);

  l1.mode = 'degraded';
  seqr.submit(signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 5n, nonce: 0n }, alice, DOMAIN));
  await engine.tick(clock); // sella #1 → DEFER (surge, sin retiros)
  await engine.tick(clock);
  assert.equal(engine.monitor.current().status, 'DEGRADED');
  assert.equal(engine.lastPolicyDecision?.action, 'DEFER');
  assert.equal(l1.commitCalls, 1, 'no se publica durante surge pricing si no es urgente');

  // Un retiro hace urgente al lote #2, pero el #1 (más antiguo, sin retiros) sigue diferido y bloquea la cola
  seqr.submit(signTx({ type: 'withdraw', from: bob.publicKey(), token: TOKEN, amount: 1n, nonce: 0n, l1Recipient: bob.publicKey() }, bob, DOMAIN));
  await engine.tick(clock);
  assert.equal(seqr.store.batchesByStatus('sealed').length, 2);
  // Pasan 61 s (> maxDeferMs) con la red aún en surge → el #1 pasa a urgente → ambos se publican pagando 2×p90
  clock += 61_000;
  l1.advanceLedgers(12);
  await engine.tick(clock);
  await engine.tick(clock + 100);
  assert.equal(l1.batches.length, 3, 'ambos lotes publicados con puja alta');
  assert.equal(seqr.store.batchesByStatus('sealed').length, 0);

  // TRY_AGAIN_LATER intermitente
  l1.mode = 'slow';
  seqr.submit(signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 5n, nonce: 1n }, alice, DOMAIN));
  await engine.tick(clock + 200); // sella #3 y primer intento → TRY_AGAIN_LATER
  const b3 = seqr.store.getBatch(3n)!;
  assert.equal(b3.status, 'sealed');
  assert.equal(b3.attempts, 1);
  assert.match(b3.lastError ?? '', /TRY_AGAIN_LATER/);
  await engine.tick(clock + 400); // backoff (DEFER)
  assert.equal(engine.lastPolicyDecision?.action, 'DEFER');
  await engine.tick(clock + 2_000); // reintento → éxito
  assert.equal(seqr.store.getBatch(3n)!.status, 'committed');
});

test('API HTTP: health, submit, cuenta, lote y prueba de retiro', async () => {
  const seqr = newSequencer();
  const l1 = new MockL1Client();
  const { engine } = engineWith(seqr, l1);
  const alice = Keypair.random();
  const bob = Keypair.random();
  l1.deposit(alice.publicKey(), TOKEN, 500n, alice.publicKey());
  await engine.tick();

  const server = createApiServer({ sequencer: seqr, engine, info: { networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE, l1Mode: 'mock', allowedTokens: [], startedAt: Date.now() } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/v1`;
  const get = async (p: string) => {
    const r = await fetch(base + p);
    return { status: r.status, body: (await r.json()) as any };
  };
  try {
    const h = await get('/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.l1.status, 'HEALTHY');

    const nonce = await get(`/accounts/${alice.publicKey()}/nonce?token=${TOKEN}`);
    assert.equal(nonce.body.nonce, '0');

    const tx = signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 120n, nonce: 0n }, alice, DOMAIN);
    const txJson = { ...tx, amount: '120', nonce: '0', signature: toHex(tx.signature) };
    const post = await fetch(`${base}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: txJson }) });
    assert.equal(post.status, 201);
    const receipt = ((await post.json()) as any).receipt;
    assert.equal(receipt.status, 'confirmed');

    const dup = await fetch(`${base}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: txJson }) });
    assert.equal(dup.status, 422);
    assert.equal(((await dup.json()) as any).error.code, 'BAD_NONCE');

    const acc = await get(`/accounts/${bob.publicKey()}`);
    assert.equal(acc.body.balances[0].balance, '120');

    const w = signTx({ type: 'withdraw', from: bob.publicKey(), token: TOKEN, amount: 20n, nonce: 0n, l1Recipient: bob.publicKey() }, bob, DOMAIN);
    const wr = await fetch(`${base}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: { ...w, amount: '20', nonce: '0', signature: toHex(w.signature) } }) });
    const wid = ((await wr.json()) as any).receipt.id as string;
    assert.equal((await get(`/withdrawals/${wid}/proof`)).status, 404, 'aún sin lote');

    await engine.tick();
    await engine.tick();
    const proof = await get(`/withdrawals/${wid}/proof`);
    assert.equal(proof.status, 200);
    assert.equal(proof.body.batchStatus, 'committed');
    const batch = await get(`/batches/${proof.body.batchIndex}?data=1`);
    assert.equal(batch.status, 200);
    assert.ok(batch.body.batch.txData);
    const txv = await get(`/transactions/${wid}`);
    assert.equal(txv.body.finality.l1, 'committed');

    // feed de la L2 completa: el más reciente primero, con su lote ya asignado
    const feed = await get('/transactions?limit=10');
    assert.equal(feed.status, 200);
    assert.equal(feed.body.transactions[0].id, wid);
    assert.equal(feed.body.transactions[0].type, 'withdraw');
    assert.ok(feed.body.transactions[0].batchIndex !== null, 'el retiro ya está en un lote');
    assert.ok(feed.body.transactions.length >= 3, 'depósito + transferencia + retiro');
    // Regresión: la latencia se mide después de persistir, así que la fila nace con 0 y hay que
    // volcarla al sellar. Si esto vuelve a 0, el explorer muestra "0.00 ms" en todos los pagos.
    const sealed = feed.body.transactions.filter((t: any) => t.batchIndex !== null);
    assert.ok(sealed.length > 0);
    for (const t of sealed) assert.ok(t.latencyUs > 0, `latencia no persistida en ${t.type}`);

    // métricas: las latencias vienen del log, no de una estimación
    const stats = await get('/stats?window=600');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.l2.txs, stats.body.l2.totalTxs);
    assert.equal(stats.body.l2.byType.withdraw, 1);
    assert.equal(stats.body.l2.byType.transfer, 1);
    assert.ok(stats.body.l2.latencyP50Us >= 0);
    assert.equal(stats.body.l1.batchesCommitted, 2, 'el del depósito y el de transferencia+retiro');
    assert.ok(stats.body.l1.avgSealToCommitMs !== null);

    assert.equal((await get('/nope')).status, 404);
  } finally {
    server.close();
  }
});

test('seguridad: un RPC comprometido no puede acuñar FXLM sin respaldo', async () => {
  const seqr = newSequencer();
  const l1 = new MockL1Client({ challengePeriodLedgers: 20 });
  const { engine, log } = engineWith(seqr, l1);
  const alice = Keypair.random();
  const atacante = Keypair.random();

  // Un depósito legítimo: el contrato lo registra de verdad.
  l1.deposit(alice.publicKey(), TOKEN, 10_000n, alice.publicKey());
  await engine.tick();
  assert.equal(seqr.state.get(alice.publicKey(), TOKEN).balance, 10_000n);

  // Ahora el ataque: el RPC anuncia un depósito de 1M que NUNCA ocurrió. Se añade al feed de
  // eventos sin registrarlo en el "contrato" — exactamente lo que haría un RPC comprometido.
  l1.deposits.push({
    index: BigInt(l1.deposits.length),
    from: atacante.publicKey(),
    token: TOKEN,
    amount: 1_000_000n,
    l2Recipient: atacante.publicKey(),
    ledger: l1.deposits.at(-1)!.ledger,
    l1TxHash: 'ff'.repeat(32),
  });

  await engine.tick();

  assert.equal(seqr.state.get(atacante.publicKey(), TOKEN).balance, 0n, 'no se acreditó nada al atacante');
  assert.ok(log.some((e) => e.kind === 'deposit_rejected'), 'el rechazo quedó registrado');
  assert.equal(seqr.state.totalsByToken().get(TOKEN), 10_000n, 'lo emitido sigue siendo solo lo real');

  // Y la red de seguridad: aunque algo se colara, la solvencia lo detecta y congela la L2.
  assert.deepEqual(await engine.checkSolvency(), [], 'con el estado real, solvente');

  // Se fuerza el peor caso: un depósito falso que SÍ pasara todas las validaciones anteriores.
  seqr.state.applyDeposit({ type: 'deposit', depositIndex: seqr.state.nextDepositIndex, to: atacante.publicKey(), token: TOKEN, amount: 5_000_000n, l1TxHash: 'ee'.repeat(32) });
  const breaches = await engine.checkSolvency();
  assert.equal(breaches.length, 1, 'detecta que se emitió más de lo que hay en la bóveda');
  assert.equal(breaches[0]!.vault, 10_000n);
  assert.equal(engine.halted, true, 'el secuenciador se detiene solo');
});
