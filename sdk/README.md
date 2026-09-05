# stellar-flash-sdk

Cliente de [Stellar Flash](https://stellar-flash.onrender.com): un rollup de pagos sobre Stellar.
Los pagos confirman en milisegundos con las mismas llaves `G…` y los mismos activos; Flash liquida
en lotes sobre Stellar y los fondos viven en un contrato Soroban del que se sale con prueba Merkle.

```bash
npm install stellar-flash-sdk @stellar/stellar-sdk
```

## Pagar

```ts
import { FlashClient, Keypair } from 'stellar-flash-sdk';

const flash = new FlashClient({
  baseUrl: 'https://stellar-flash-sequencer.onrender.com',
  keypair: Keypair.fromSecret(process.env.SECRET!),
});

const receipt = await flash.transfer({
  to: 'GBXRLWDXMS53IWIORBCCOYBG5JPVUBZ36RVFH3R2FZB5OEJ5ZJWFIZ7E',
  token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // XLM (SAC) en testnet
  amount: 25_000_000n, // stroops: 2,5 XLM
});

receipt.latencyUs; // 6_005 — medido por el secuenciador, no estimado
receipt.finality;  // { l2: 'instant', l1: 'pending' }
```

## Firmar con la wallet del usuario

Los pagos se firman con **SEP-53**, así que cualquier wallet de Stellar con `signMessage` sirve
sin cambios. Si el cliente no tiene la llave (una dapp en el navegador), pide el mensaje y envía
la firma:

```ts
const { message, tx } = await flash.signingMessage({
  type: 'transfer', from: userAddress, to, token, amount: 25_000_000n,
});

const signature = await wallet.signMessage(message); // Freighter, xBull, Lobstr…

await flash.submitSigned({ ...tx, signature: Buffer.from(signature).toString('hex') });
```

## Dos niveles de finalidad

Enséñalos siempre los dos: es lo que da confianza.

| | Qué significa | Cuándo |
|---|---|---|
| `finality.l2` | Confirmado en Flash, el saldo ya se movió | inmediato (~6 ms) |
| `finality.l1` | El lote está publicado en Stellar | segundos después |

## Depositar y retirar

```ts
// Entrar: transacción de Stellar; el saldo aparece en Flash cuando el ledger cierra.
const deposit = await flash.buildDepositTx({ server, from, token, amount: 100_000_000n });

// Salir: se quema en Flash y se reclama en L1 con la prueba Merkle, pasado el periodo de desafío.
const { id } = await flash.withdraw({ token, amount: 20_000_000n, l1Recipient: from });
const proof = await flash.getWithdrawalProof(id);
if (proof.claimable) await flash.buildWithdrawClaimTx({ server, source: from, proof });
```

El contrato tiene además `escape`, que **el administrador no puede pausar**: si el secuenciador
desaparece, los fondos salen igual.

## Notas

- Requiere Node ≥ 20. El paquete es de servidor: el protocolo usa `node:crypto`. Para el navegador
  hará falta un build con sha256 portable.
- `@stellar/stellar-sdk` ^17 es *peer dependency*: se usa la copia de tu proyecto.
- Software en testnet. Los activos de testnet no valen nada.

Código y documentación: https://github.com/nadevrix/stellar-flash · MIT.
