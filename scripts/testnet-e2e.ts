/**
 * Fase 0 · prueba end-to-end contra Stellar TESTNET real.
 *
 * Requiere: `bash scripts/deploy-testnet.sh` ejecutado (deja .env con el contrato y TEST_USER_SECRET)
 * y el secuenciador corriendo en L1_MODE=rpc (`set -a; source .env; set +a; node sequencer/src/index.ts`).
 *
 * Qué comprueba, en orden:
 *  1. El depósito real de L1 está acreditado en Flash.
 *  2. Un pago L2 confirma en milisegundos (latencia medida por el secuenciador).
 *  3. Un retiro L2 entra en un lote y ese lote se publica en Stellar (`commit_batch` real).
 *  4. Pasado el periodo de desafío, la prueba Merkle se reclama en L1 (`withdraw`) y el XLM vuelve.
 *
 * Uso: set -a; source .env; set +a; node scripts/testnet-e2e.ts
 */
import { rpc } from '@stellar/stellar-sdk';
import { FlashApiError, FlashClient, Keypair, type WithdrawalProofView } from '../sdk/src/index.ts';

const BASE_URL = process.env.FLASH_URL ?? 'http://127.0.0.1:8787';
const RPC_URL = (process.env.RPC_URLS ?? 'https://soroban-testnet.stellar.org').split(',')[0]!.trim();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const xlm = (stroops: bigint): string => `${Number(stroops) / 1e7} XLM`;

const userSecret = process.env.TEST_USER_SECRET;
if (!userSecret) throw new Error('falta TEST_USER_SECRET en .env (lo escribe scripts/deploy-testnet.sh)');
const user = Keypair.fromSecret(userSecret);
const bob = Keypair.random(); // destinatario L2: no necesita existir en L1

const flash = new FlashClient({ baseUrl: BASE_URL, keypair: user });
const bobFlash = new FlashClient({ baseUrl: BASE_URL, keypair: bob });
const server = new rpc.Server(RPC_URL);

const net = await flash.network();
const token = net.allowedTokens[0]!;
console.log(`puente ${net.bridgeContractId} · token ${token}\nusuario ${user.publicKey()}\n`);

// --- 1. depósito acreditado ---------------------------------------------------------------
const balance0 = await flash.getBalance(user.publicKey(), token);
console.log(`1. saldo Flash inicial (depósito acreditado desde L1): ${xlm(balance0)}`);
if (balance0 <= 0n) throw new Error('el secuenciador aún no ha acreditado el depósito: ¿está corriendo en L1_MODE=rpc?');

// --- 2. pago L2 instantáneo ---------------------------------------------------------------
const pay = await flash.transfer({ to: bob.publicKey(), token, amount: 30_000_000n });
console.log(`2. pago de 3 XLM a ${bob.publicKey().slice(0, 8)}… confirmado en ${(pay.latencyUs / 1000).toFixed(2)} ms (tx ${pay.id.slice(0, 16)}…)`);
console.log(`   saldo de bob en Flash: ${xlm(await bobFlash.getBalance(bob.publicKey(), token))}`);

// --- 3. retiro L2 → lote → commit_batch en Stellar -----------------------------------------
const wd = await bobFlash.withdraw({ token, amount: 20_000_000n, l1Recipient: user.publicKey() });
console.log(`3. retiro de 2 XLM pedido por bob hacia ${user.publicKey().slice(0, 8)}… (tx ${wd.id.slice(0, 16)}…)`);

// La prueba no existe hasta que el retiro entra en un lote sellado (404 mientras tanto).
const fetchProof = async (): Promise<WithdrawalProofView | null> => {
  try {
    return await bobFlash.getWithdrawalProof(wd.id);
  } catch (e) {
    if (e instanceof FlashApiError && e.code === 'WITHDRAWAL_NOT_FOUND') return null;
    throw e;
  }
};
let proof = await fetchProof();
const t0 = Date.now();
while (!proof?.claimable) {
  if (Date.now() - t0 > 15 * 60_000) throw new Error('timeout esperando a que el lote finalice');
  await sleep(5_000);
  proof = await fetchProof();
  if (!proof) continue;
  process.stdout.write(`   lote #${proof.batchIndex}: ${proof.batchStatus}${proof.l1TxHash ? ` · L1 tx ${proof.l1TxHash.slice(0, 12)}…` : ''}          \r`);
}
console.log(`\n   lote #${proof.batchIndex} finalizado · commit_batch en L1: ${proof.l1TxHash} (ledger ${proof.commitLedger})`);
console.log(`   https://stellar.expert/explorer/testnet/tx/${proof.l1TxHash}`);

// --- 4. reclamo en L1 con la prueba Merkle --------------------------------------------------
const claim = await flash.buildWithdrawClaimTx({ server, source: user.publicKey(), proof });
claim.sign(user);
const sent = await server.sendTransaction(claim);
if (sent.status === 'ERROR') throw new Error(`envío rechazado: ${sent.errorResult?.toXDR('base64')}`);
console.log(`4. withdraw enviado a Stellar: ${sent.hash}`);
let got = await server.getTransaction(sent.hash);
while (got.status === 'NOT_FOUND') {
  await sleep(2_000);
  got = await server.getTransaction(sent.hash);
}
if (got.status !== 'SUCCESS') throw new Error(`withdraw falló en L1: ${JSON.stringify(got, null, 2)}`);
console.log(`   ✅ 2 XLM devueltos a ${user.publicKey()} en el ledger ${got.ledger}`);
console.log(`   https://stellar.expert/explorer/testnet/tx/${sent.hash}`);

console.log(`\nsaldos Flash finales: usuario ${xlm(await flash.getBalance(user.publicKey(), token))} · bob ${xlm(await bobFlash.getBalance(bob.publicKey(), token))}`);
