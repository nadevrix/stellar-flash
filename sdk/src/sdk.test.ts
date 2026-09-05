import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { domainSeparator, fromHex, toHex, verifyProof, withdrawalLeaf } from '../../protocol/src/index.ts';
import { Sequencer } from '../../sequencer/src/core/sequencer.ts';
import { Store } from '../../sequencer/src/db/store.ts';
import { SettlementEngine } from '../../sequencer/src/settlement/engine.ts';
import { L1HealthMonitor } from '../../sequencer/src/settlement/health.ts';
import { MockL1Client } from '../../sequencer/src/settlement/l1.ts';
import { createApiServer } from '../../sequencer/src/api/server.ts';
import { FlashApiError, FlashClient } from './index.ts';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const BRIDGE = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

test('SDK: transfer/withdraw contra un secuenciador real (mock L1) y prueba de retiro verificable', async () => {
  const domain = domainSeparator({ networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE });
  const seqr = Sequencer.open({ domain, store: new Store(':memory:'), maxBatchBytes: 60_000, maxBatchTxs: 250 });
  const l1 = new MockL1Client();
  const monitor = new L1HealthMonitor(l1, { healthyLedgerAgeSec: 15, downLedgerAgeSec: 60, surgeFeeStroops: 2_000 }, 1_000);
  const engine = new SettlementEngine(seqr, l1, monitor, { minInclusionFeeStroops: 200, maxInclusionFeeStroops: 1_000_000, maxDeferMs: 60_000, sealIntervalMs: 0, challengePeriodLedgers: 5, depositScanStartLedger: 0 });
  const server = createApiServer({ sequencer: seqr, engine, info: { networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE, l1Mode: 'mock', allowedTokens: [], startedAt: Date.now() } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const alice = Keypair.random();
  const bob = Keypair.random();
  try {
    l1.deposit(alice.publicKey(), TOKEN, 1_000n, alice.publicKey());
    await engine.tick();

    const flash = new FlashClient({ baseUrl, keypair: alice });
    assert.equal(await flash.getBalance(alice.publicKey(), TOKEN), 1_000n);
    const r = await flash.transfer({ to: bob.publicKey(), token: TOKEN, amount: 250n });
    assert.equal(r.status, 'confirmed');
    assert.equal(await flash.getBalance(bob.publicKey(), TOKEN), 250n);
    // nonce se gestiona solo
    await flash.transfer({ to: bob.publicKey(), token: TOKEN, amount: 50n });
    assert.equal(await flash.getBalance(alice.publicKey(), TOKEN), 700n);

    await assert.rejects(() => flash.transfer({ to: bob.publicKey(), token: TOKEN, amount: 10_000n }), (e: unknown) => e instanceof FlashApiError && e.code === 'INSUFFICIENT_BALANCE');

    const bobFlash = new FlashClient({ baseUrl, keypair: bob });
    const w = await bobFlash.withdraw({ token: TOKEN, amount: 100n });
    await engine.tick(); // sella + publica
    await bobFlash.waitForL1(w.id, 'committed', 5_000, 50);
    const proof = await bobFlash.getWithdrawalProof(w.id);
    assert.equal(proof.claimable, false);
    assert.ok(verifyProof(withdrawalLeaf(BigInt(proof.batchIndex), proof.wIndex, bob.publicKey(), TOKEN, 100n), proof.wIndex, proof.proof.map(fromHex), fromHex(proof.withdrawalsRoot)));
    l1.advanceLedgers(5);
    await engine.tick();
    assert.equal((await bobFlash.getWithdrawalProof(w.id)).claimable, true);

    // Flujo de wallet (SEP-53): el cliente NO tiene la llave; construye el mensaje, lo firma
    // quien sea dueño de la cuenta con `signMessage` — que es lo que hacen Freighter, xBull o
    // Lobstr — y se envía la firma. Es el camino que usará la dapp de puente.
    const walletless = new FlashClient({ baseUrl });
    const { message, tx } = await walletless.signingMessage({
      type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 33n,
    });
    const signature = toHex(new Uint8Array(alice.signMessage(Buffer.from(message))));
    const walletReceipt = await walletless.submitSigned({ ...tx, signature });
    assert.equal(walletReceipt.status, 'confirmed');
    assert.equal(await flash.getBalance(alice.publicKey(), TOKEN), 667n, '700 - 33');
  } finally {
    server.close();
  }
});
