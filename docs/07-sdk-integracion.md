# 07 · SDK e integración para desarrolladores

Código: `sdk/src/index.ts` · test: `sdk/src/sdk.test.ts` (flujo completo contra un secuenciador real con L1 simulada).

## 1. Promesa "drop-in"

Antes (Stellar L1):
```ts
const tx = new TransactionBuilder(account, { fee, networkPassphrase }).addOperation(Operation.payment({...})).setTimeout(30).build();
tx.sign(kp);
const res = await server.sendTransaction(tx);      // PENDING…
// polling getTransaction, manejar TRY_AGAIN_LATER, tx_bad_seq, surge…  (5–30 s)
```
Después (Flash):
```ts
import { FlashClient } from '@stellar-flash/sdk';
const flash = new FlashClient({ baseUrl: 'https://api.flash.example', keypair: kp });
const receipt = await flash.transfer({ to: 'G…', token: USDC_SAC, amount: 5_0000000n }); // confirmed en ~ms
```
Misma llave (`Keypair` de Stellar), mismos tokens (direcciones SAC), sin números de secuencia, sin fees que ajustar.

## 2. API del cliente

| Método | Descripción |
|---|---|
| `health()` | estado L2/L1 y `network` (passphrase, puente, tokens) |
| `getAccount(g)` / `getBalance(g, token)` / `getNonce(g, token)` | lectura de estado |
| `transfer({ to, token, amount, nonce? })` | firma con el keypair y envía; devuelve recibo |
| `withdraw({ token, amount, l1Recipient?, nonce? })` | quema en L2; luego reclamar en L1 |
| `submitSigned(txJson)` | enviar una tx firmada por otro (p. ej. por una wallet) |
| `getTransaction(id)` / `waitForL1(id, 'committed'|'finalized')` | seguimiento de finalidad L1 (opcional) |
| `getWithdrawalProof(txId)` | prueba Merkle para reclamar |
| `buildDepositTx({ server, from, token, amount, l2Recipient? })` | tx Stellar (sin firmar) que llama `deposit` en el puente |
| `buildWithdrawClaimTx({ server, source, proof })` | tx Stellar (sin firmar) que llama `withdraw` con la prueba |

Errores: `FlashApiError { status, code, message, details }` con códigos `INVALID_SIGNATURE`, `BAD_NONCE` (details.expected), `INSUFFICIENT_BALANCE` (details.balance), `INVALID_AMOUNT`, `SELF_TRANSFER`, `TOKEN_NOT_ALLOWED`, `TX_NOT_FOUND`, …

## 3. Firmar desde una wallet (Freighter, etc.) — SEP-53

Flash firma `sha256("Stellar Signed Message:\n" || domain || body)` con ed25519: es **exactamente SEP-53**, el estándar de firma de mensajes de Stellar que implementan `Keypair.signMessage`, el CLI (`stellar message sign`) y las wallets.

Flujo en el frontend (sin exponer la llave):
```ts
import { signingMessage, txToJson, domainSeparator } from '@stellar-flash/protocol';
const net = await flash.network();
const domain = domainSeparator({ networkPassphrase: net.passphrase, bridgeContractId: net.bridgeContractId });
const unsigned = { type: 'transfer', from, to, token, amount, nonce: await flash.getNonce(from, token) };
const message = signingMessage(unsigned, domain);            // bytes
const signature = await wallet.signMessage(message, { address: from }); // SEP-53 en la wallet (formato según wallet: bytes/base64)
await flash.submitSigned(txToJson({ ...unsigned, signature }));
```
Pendiente de verificar: el formato exacto que acepta `signMessage` en Freighter (string vs bytes/base64) y si aplica el prefijo SEP-53 (debería). Si una wallet solo firma strings, usar `base64(message)` como string y actualizar `signingMessage`/verificación en consecuencia (cambio de una línea en `protocol/src/tx.ts` + contrato no afectado).

## 4. Patrones de integración

### 4.1 Plataforma de pagos masivos (bounties, nóminas)
```ts
for (const p of payouts) await flash.transfer({ to: p.address, token: USDC, amount: p.amount });
// N pagos en N×~3 ms. Sin channel accounts, sin tx_bad_seq. Un lote L1 los liquida todos.
```
Los destinatarios pueden gastar en Flash inmediatamente o retirar a L1 (`withdraw` → tras el periodo de desafío, `buildWithdrawClaimTx`). La plataforma puede ofrecer "retiro asistido": ella paga la tx de `withdraw` en L1 (es *permissionless*).

### 4.2 Checkout / POS
El comercio muestra un QR con `{to, token, amount, memo}`; la wallet del cliente firma SEP-53 y envía; el POS hace `GET /v1/accounts/:comercio` o escucha eventos → confirmación en < 1 s incluyendo red.

### 4.3 Juegos / micro-pagos
Cada acción = `transfer` de 0.0001 XLM. Con 350+ tx/s por secuenciador sin optimizar, alcanza para miles de jugadores; el coste L1 no crece con el número de pagos.

### 4.4 Agentes de IA
El agente tiene un `Keypair`; paga por tarea con `transfer` y verifica con `getTransaction`. Integración natural con Trustless Work / escrows: el escrow libera en Flash y liquida a L1 en lote.

## 5. Depósito y retiro paso a paso (dev)

```ts
import { rpc, Keypair } from '@stellar/stellar-sdk';
const server = new rpc.Server('https://soroban-testnet.stellar.org');
// 1) L1 → L2
const dep = await flash.buildDepositTx({ server, from: kp.publicKey(), token: XLM_SAC, amount: 100_0000000n });
dep.sign(kp); await server.sendTransaction(dep);           // el secuenciador acredita en ~1–2 ledgers
// 2) L2 → L1
const w = await flash.withdraw({ token: XLM_SAC, amount: 10_0000000n });
await flash.waitForL1(w.id, 'finalized');                   // periodo de desafío
const proof = await flash.getWithdrawalProof(w.id);
const claim = await flash.buildWithdrawClaimTx({ server, source: kp.publicKey(), proof });
claim.sign(kp); await server.sendTransaction(claim);
```

## 6. Publicación del paquete (pendiente)
- Separar `protocol/` y `sdk/` como paquetes npm (`@stellar-flash/protocol`, `@stellar-flash/sdk`) con build a ESM+CJS (tsup) y tipos. Hoy se importan por ruta relativa para ejecutar TS sin build.
- El SDK depende de `@stellar/stellar-sdk` ≥ 17 (peer dependency).
- Versión browser: `node:crypto` → `crypto.subtle` (sha256) y `Buffer` → `Uint8Array` en `protocol/src/bytes.ts`. Todo lo demás ya es agnóstico.
