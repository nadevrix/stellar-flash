/**
 * Mide el coste real de `commit_batch` en Stellar con un lote grande.
 *
 * Responde a la pregunta que decide `MAX_BATCH_BYTES`: cuánto cuesta publicar un lote lleno,
 * y por tanto cuánto cuesta operar Flash por cada 1000 pagos.
 *
 * Uso: set -a; source .env; set +a; node scripts/measure-batch-cost.ts [nº de pagos]
 *      FLASH_URL=https://…onrender.com node scripts/measure-batch-cost.ts 250
 */
import { rpc } from '@stellar/stellar-sdk';
import { FlashClient, Keypair } from '../sdk/src/index.ts';

const BASE_URL = process.env.FLASH_URL ?? 'http://127.0.0.1:8787';
const RPC_URL = (process.env.RPC_URLS ?? 'https://soroban-testnet.stellar.org').split(',')[0]!.trim();
const COUNT = Number(process.argv[2] ?? 250);
const AMOUNT = 10_000n; // 0,001 XLM por pago

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secret = process.env.TEST_USER_SECRET;
if (!secret) throw new Error('falta TEST_USER_SECRET');
const user = Keypair.fromSecret(secret);
const flash = new FlashClient({ baseUrl: BASE_URL, keypair: user });

const net = await flash.network();
const token = net.allowedTokens[0]!;
const balance = await flash.getBalance(user.publicKey(), token);
if (balance < AMOUNT * BigInt(COUNT)) throw new Error(`saldo insuficiente: ${balance} < ${AMOUNT * BigInt(COUNT)}`);

// El nonce se pide una sola vez y se incrementa: pedirlo por pago añadiría una ida y vuelta HTTP
// a cada uno y mediríamos la red, no el secuenciador.
let nonce = await flash.getNonce(user.publicKey(), token);
const dest = Keypair.random().publicKey();

console.log(`enviando ${COUNT} pagos a ${BASE_URL}…`);
const t0 = Date.now();
const latencies: number[] = [];
let lastId = '';
for (let i = 0; i < COUNT; i++) {
  const r = await flash.transfer({ to: dest, token, amount: AMOUNT, nonce: nonce++ });
  latencies.push(r.latencyUs);
  lastId = r.id;
}
const wall = Date.now() - t0;
latencies.sort((a, b) => a - b);
const p = (q: number) => (latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]! / 1000).toFixed(2);
console.log(`  ${COUNT} pagos en ${(wall / 1000).toFixed(1)} s (${(COUNT / (wall / 1000)).toFixed(0)}/s incluyendo la red)`);
console.log(`  latencia del secuenciador: p50 ${p(0.5)} ms · p99 ${p(0.99)} ms`);

// --- esperar al lote del ÚLTIMO pago ---
// Se sigue ese lote en concreto en vez de buscar "uno grande": si el cliente es lento, los pagos
// se reparten en muchos lotes pequeños y adivinar no funciona (pasó al medir contra producción
// desde otra región: 288 ms de ida y vuelta por pago).
console.log('esperando a que el lote se publique en Stellar…');
const server = new rpc.Server(RPC_URL);
type BatchView = { index: string; status: string; txCount: number; txDataBytes: number; l1TxHash: string | null };
let batch: BatchView | null = null;
for (let i = 0; i < 120; i++) {
  const t = await flash.getTransaction(lastId);
  if (t.batch?.l1TxHash) {
    const r = await fetch(`${BASE_URL}/v1/batches/${t.batch.index}`);
    batch = ((await r.json()) as { batch: BatchView }).batch;
    break;
  }
  await sleep(2_000);
}
if (!batch?.l1TxHash) throw new Error('el lote no se publicó a tiempo');
if (batch.txCount < COUNT * 0.5) {
  console.warn(`aviso: el lote solo llevaba ${batch.txCount} de ${COUNT} pagos. El cliente va más lento`);
  console.warn('que el intervalo de sellado, así que los pagos se repartieron. Corre esto contra un');
  console.warn('secuenciador local (la L1 sigue siendo real) para llenar un lote.');
}

const tx = await server.getTransaction(batch.l1TxHash);
if (tx.status !== 'SUCCESS') throw new Error(`la tx L1 no fue exitosa: ${tx.status}`);

// SDK v17: `resultXdr.toXdrObject()` devuelve un objeto plano — `feeCharged` es una propiedad,
// no un método, y `resultXdr.result()` no existe.
const envelopeBytes = Buffer.from(tx.envelopeXdr.toXDR('base64'), 'base64').length;
const feeStroops = Number((tx.resultXdr.toXdrObject() as unknown as { feeCharged: bigint | number }).feeCharged.toString());

console.log(`\nlote #${batch.index}: ${batch.txCount} pagos · ${batch.txDataBytes} B de datos · tx L1 ${envelopeBytes} B`);
console.log(`  https://stellar.expert/explorer/testnet/tx/${batch.l1TxHash}`);
console.log(`  fee cobrada: ${feeStroops} stroops = ${(feeStroops / 1e7).toFixed(7)} XLM`);
console.log(`  coste por pago: ${(feeStroops / batch.txCount).toFixed(1)} stroops`);
console.log(`  coste por 1000 pagos: ${((feeStroops / batch.txCount) * 1000 / 1e7).toFixed(6)} XLM`);
