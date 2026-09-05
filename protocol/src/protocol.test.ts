import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  FlashError,
  FlashState,
  ZERO32,
  buildTree,
  bytesToI128,
  computeRoot,
  decodeAddress,
  decodeBatchData,
  domainSeparator,
  encodeAddress,
  encodeBatchData,
  encodeTx,
  decodeTx,
  getProof,
  i128ToBytes,
  replayBatch,
  signTx,
  signingMessage,
  stateLeaf,
  toHex,
  txFromJson,
  txId,
  txToJson,
  verifyProof,
  verifyTxSignature,
  withdrawalLeaf,
  withdrawalsTree,
} from './index.ts';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const BRIDGE = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const DOMAIN = domainSeparator({ networkPassphrase: Networks.TESTNET, bridgeContractId: BRIDGE });

// Vectores generados con `cargo test print_vectors -- --nocapture` (contrato Rust).
test('vectores cruzados Rust ↔ TS (hojas y raíz)', () => {
  const alice = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const bob = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
  const l1 = stateLeaf(alice, TOKEN, 1_000_000_000n, 0n);
  const l2 = stateLeaf(bob, TOKEN, 42n, 7n);
  const l3 = withdrawalLeaf(3n, 1, bob, TOKEN, 12_345n);
  assert.equal(toHex(l1), '5a6ba13da68a7098fbd84ef1de0f747d19258d8fbea49df462758084844d3009');
  assert.equal(toHex(l2), '266b6cce5091bb2f4b46c7dbc42535fc7677b906adf6606e27631565b92c79bf');
  assert.equal(toHex(l3), '72a6422d8a986b97a297e2e455b1c62f6682d35c607ca50be120f35a2d73e3fb');
  const tree = buildTree([l1, l2, l3]);
  assert.equal(toHex(tree.root), '85aa141390af7b3d68f6c865ebe51225f1aeddf0a6d28f7c6010605a55d6f29d');
  const proof = getProof(tree, 1);
  assert.equal(proof.length, 2);
  assert.ok(verifyProof(l2, 1, proof, tree.root));
  assert.ok(!verifyProof(l2, 0, proof, tree.root));
  assert.ok(!verifyProof(l1, 1, proof, tree.root));
});

test('merkle: árbol vacío, una hoja, y pruebas para todas las hojas', () => {
  assert.deepEqual(computeRoot([]), ZERO32);
  const single = stateLeaf('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', TOKEN, 1n, 0n);
  assert.deepEqual(computeRoot([single]), single);
  const leaves = Array.from({ length: 7 }, (_, i) => stateLeaf(Keypair.random().publicKey(), TOKEN, BigInt(i), 0n));
  const tree = buildTree(leaves);
  leaves.forEach((leaf, i) => assert.ok(verifyProof(leaf, i, getProof(tree, i), tree.root), `hoja ${i}`));
});

test('codificación i128 y direcciones', () => {
  for (const v of [0n, 1n, -1n, 12345678901234567890n, (1n << 127n) - 1n, -(1n << 127n)]) {
    assert.equal(bytesToI128(i128ToBytes(v)), v);
  }
  assert.throws(() => i128ToBytes(1n << 127n));
  const g = Keypair.random().publicKey();
  const eg = encodeAddress(g);
  assert.equal(eg.length, 44);
  assert.equal(decodeAddress(eg, 0).address, g);
  const ec = encodeAddress(TOKEN);
  assert.equal(ec.length, 40);
  assert.equal(decodeAddress(ec, 0).address, TOKEN);
  assert.throws(() => encodeAddress('no-es-direccion'));
});

test('tx: firma, verificación, codificación y roundtrip de lote', () => {
  const kp = Keypair.random();
  const to = Keypair.random().publicKey();
  const tx = signTx({ type: 'transfer', from: kp.publicKey(), to, token: TOKEN, amount: 1_000n, nonce: 0n }, kp, DOMAIN);
  assert.ok(verifyTxSignature(tx, DOMAIN));
  // Compatibilidad SEP-53: una wallet que firme `signingMessage` con signMessage produce la misma firma
  const walletSig = new Uint8Array(kp.signMessage(Buffer.from(signingMessage(tx, DOMAIN))));
  assert.deepEqual(walletSig, tx.signature);
  // Otra red/otro puente → la firma no vale (no hay replay cross-chain)
  const otherDomain = domainSeparator({ networkPassphrase: Networks.PUBLIC, bridgeContractId: BRIDGE });
  assert.ok(!verifyTxSignature(tx, otherDomain));
  // Manipular el monto invalida la firma
  assert.ok(!verifyTxSignature({ ...tx, amount: 1_001n }, DOMAIN));
  // Firmar con otra llave falla
  assert.throws(() => signTx({ type: 'transfer', from: kp.publicKey(), to, token: TOKEN, amount: 1n, nonce: 0n }, Keypair.random(), DOMAIN));

  const w = signTx({ type: 'withdraw', from: kp.publicKey(), token: TOKEN, amount: 5n, nonce: 1n, l1Recipient: to }, kp, DOMAIN);
  const d = { type: 'deposit', depositIndex: 0n, to: kp.publicKey(), token: TOKEN, amount: 10n, l1TxHash: 'ab'.repeat(32) } as const;
  for (const t of [tx, w, d]) {
    const enc = encodeTx(t);
    const dec = decodeTx(enc, 0);
    assert.equal(dec.next, enc.length);
    assert.deepEqual(dec.tx, t);
    assert.deepEqual(txFromJson(txToJson(t)), t);
  }
  const batch = encodeBatchData([d, tx, w]);
  assert.deepEqual(decodeBatchData(batch), [d, tx, w]);
  assert.notEqual(txId(tx, DOMAIN), txId(w, DOMAIN));
  assert.equal(txId(tx, DOMAIN).length, 64);
});

test('estado: depósitos, transferencias, nonces, retiros y determinismo de raíz', () => {
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random().publicKey();
  const st = new FlashState(DOMAIN);

  // depósito fuera de orden
  assert.throws(
    () => st.applyDeposit({ type: 'deposit', depositIndex: 1n, to: alice.publicKey(), token: TOKEN, amount: 100n, l1TxHash: '00'.repeat(32) }),
    (e: unknown) => e instanceof FlashError && e.code === 'DEPOSIT_OUT_OF_ORDER',
  );
  st.applyDeposit({ type: 'deposit', depositIndex: 0n, to: alice.publicKey(), token: TOKEN, amount: 1_000n, l1TxHash: '00'.repeat(32) });
  assert.equal(st.get(alice.publicKey(), TOKEN).balance, 1_000n);
  assert.equal(st.nextDepositIndex, 1n);

  const t1 = signTx({ type: 'transfer', from: alice.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 300n, nonce: 0n }, alice, DOMAIN);
  st.applyTransfer(t1);
  assert.equal(st.get(alice.publicKey(), TOKEN).balance, 700n);
  assert.equal(st.get(alice.publicKey(), TOKEN).nonce, 1n);
  assert.equal(st.get(bob.publicKey(), TOKEN).balance, 300n);

  // replay del mismo tx → BAD_NONCE
  assert.throws(() => st.applyTransfer(t1), (e: unknown) => e instanceof FlashError && e.code === 'BAD_NONCE');
  // saldo insuficiente
  const big = signTx({ type: 'transfer', from: bob.publicKey(), to: carol, token: TOKEN, amount: 301n, nonce: 0n }, bob, DOMAIN);
  assert.throws(() => st.applyTransfer(big), (e: unknown) => e instanceof FlashError && e.code === 'INSUFFICIENT_BALANCE');
  // firma inválida
  assert.throws(
    () => st.applyTransfer({ ...t1, nonce: 1n }),
    (e: unknown) => e instanceof FlashError && e.code === 'INVALID_SIGNATURE',
  );
  // self transfer
  assert.throws(
    () => st.applyTransfer(signTx({ type: 'transfer', from: bob.publicKey(), to: bob.publicKey(), token: TOKEN, amount: 1n, nonce: 0n }, bob, DOMAIN)),
    (e: unknown) => e instanceof FlashError && e.code === 'SELF_TRANSFER',
  );

  const wd = signTx({ type: 'withdraw', from: bob.publicKey(), token: TOKEN, amount: 100n, nonce: 0n, l1Recipient: carol }, bob, DOMAIN);
  const rec = st.applyWithdraw(wd);
  assert.deepEqual(rec, { recipient: carol, token: TOKEN, amount: 100n });
  assert.equal(st.get(bob.publicKey(), TOKEN).balance, 200n);

  // Determinismo: re-ejecutar desde cero da la misma raíz
  const st2 = new FlashState(DOMAIN);
  const res = replayBatch(st2, 0n, [
    { type: 'deposit', depositIndex: 0n, to: alice.publicKey(), token: TOKEN, amount: 1_000n, l1TxHash: '00'.repeat(32) },
    t1,
    wd,
  ]);
  assert.ok(res.ok);
  assert.equal(toHex(res.newStateRoot), st.rootHex());
  assert.equal(res.withdrawals.length, 1);
  assert.equal(toHex(res.withdrawalsRoot), toHex(withdrawalsTree(0n, res.withdrawals).root));

  // Un lote con una tx inválida es detectado (base de la prueba de fraude)
  const st3 = new FlashState(DOMAIN);
  const bad = replayBatch(st3, 0n, [t1]);
  assert.ok(!bad.ok);
  assert.equal(bad.failedTxIndex, 0);

  // Prueba de saldo (escape hatch) verifica contra la raíz
  const p = st.proofFor(alice.publicKey(), TOKEN);
  assert.ok(verifyProof(stateLeaf(alice.publicKey(), TOKEN, p.balance, p.nonce), p.leafIndex, p.proof, p.root));
  assert.equal(toHex(p.root), st.rootHex());

  // Snapshot/restore
  const restored = FlashState.fromSnapshot(DOMAIN, st.snapshot());
  assert.equal(restored.rootHex(), st.rootHex());
  assert.equal(restored.nextDepositIndex, st.nextDepositIndex);
});

test('estado: lista blanca de tokens', () => {
  const st = new FlashState(DOMAIN, { allowedTokens: new Set([TOKEN]) });
  assert.throws(
    () => st.applyDeposit({ type: 'deposit', depositIndex: 0n, to: Keypair.random().publicKey(), token: BRIDGE, amount: 1n, l1TxHash: '00'.repeat(32) }),
    (e: unknown) => e instanceof FlashError && e.code === 'TOKEN_NOT_ALLOWED',
  );
});
