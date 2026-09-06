/**
 * Ejemplo: plataforma que paga bounties en FXLM (testnet).
 *
 * Uso:
 *   set -a; source .env; set +a
 *   FLASH_URL=https://stellar-flash-sequencer.onrender.com node examples/bounty-pay.ts
 *
 * Requiere: la cuenta en SECRET con float FXLM (deposita primero en /bridge).
 */
import { FlashClient, Keypair } from '../sdk/src/index.ts';

const BASE = process.env.FLASH_URL ?? 'https://stellar-flash-sequencer.onrender.com';
const secret = process.env.SEQUENCER_SECRET ?? process.env.TEST_USER_SECRET;
if (!secret) throw new Error('falta SECRET (cuenta con FXLM)');

const platform = Keypair.fromSecret(secret);
const flash = new FlashClient({ baseUrl: BASE, keypair: platform });

const net = await flash.network();
const token = net.allowedTokens[0]!;

// Destinatarios de ejemplo (cualquier G… válida en testnet)
const payouts = [
  { address: 'GBXRLWDXMS53IWIORBCCOYBG5JPVUBZ36RVFH3R2FZB5OEJ5ZJWFIZ7E', amount: 1_000_000n },
  { address: 'GBIRCH2OFOTUXOJTCTQL53HZNCX32YDWUAWUTAARONH6WUIC2IZGBLFT', amount: 500_000n },
];

console.log(`pagando ${payouts.length} bounties desde ${platform.publicKey()}…`);
const t0 = Date.now();
for (const p of payouts) {
  const r = await flash.transfer({ to: p.address, token, amount: p.amount });
  console.log(`  → ${p.address.slice(0, 8)}… ${Number(p.amount) / 1e7} FXLM · ${(r.latencyUs / 1000).toFixed(2)} ms`);
}
console.log(`listo en ${Date.now() - t0} ms`);
