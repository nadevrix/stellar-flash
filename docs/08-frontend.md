# 08 · Frontend

> **Estado (sep 2026): IMPLEMENTADO** en `frontend/`. UI estilo Stellar Lab (sidebar, wallet global, tema claro).  
> Guía pública en inglés: [`11-product-and-deployment.md`](11-product-and-deployment.md) · [`00-START-HERE.md`](00-START-HERE.md).

El backend expone todo lo necesario por HTTP JSON con CORS abierto. Este documento define qué construir, con qué y cómo — la mayoría ya está hecha; lo que falta está marcado abajo.

## 1. Productos de frontend (en orden de prioridad)

1. **Flash Explorer + panel de salud** — done: `/explorer`, `/tx/:id`, `/batches/:index`, `/accounts/:G`
2. **Flash Bridge (dapp de usuario)** — done: `/bridge` (deposit, pay, withdraw, claim)
3. **Account dashboard** — done: `/account` + wallet global en header
4. **Consola de desarrollador** — done: `/developers` (docs + API); planned: API keys / métricas por app (fase 2)

## 2. Stack recomendado

- **Vite + React 19 + TypeScript + Tailwind 4** (mismo stack que el proyecto ROLEX del repo padre, así hay familiaridad). Alternativa igual de válida: Next.js si se quiere SSR para SEO del explorer.
- Estado/data: **TanStack Query** con `refetchInterval` de 1–2 s para health/lotes (o SSE cuando se añada al backend; ver §6).
- Wallet: **Stellar Wallets Kit** (`@creit.tech/stellar-wallets-kit`) para soportar Freighter, xBull, Albedo, Lobstr, Hana con una sola integración. Necesita `signTransaction` (depósitos/retiros L1) y `signMessage` (pagos Flash, SEP-53; ver `07-sdk-integracion.md#3`).
- Stellar: `@stellar/stellar-sdk` (rpc.Server para L1) + `@stellar-flash/sdk` (este repo).
- Gráficas: Recharts (latencia, txs/s, estado L1 en el tiempo).
- Identidad visual: la de Stellar Flash → negro + amarillo (#FFD100) + acentos violeta, tipografía condensada para titulares (coherente con el estilo de BAF × Stellar de la imagen de aceptación a Stellar Elite).

## 3. Pantallas del Explorer

### 3.1 Home / "Live"
- **Semáforo L1**: HEALTHY/DEGRADED/DOWN con `reason`, `latestLedger`, `ledgerAgeSec`, `feeP90`, endpoints con ok/fail y latencia. Fuente: `GET /v1/health` → `l1`.
- **Decisión de settlement actual**: `settlement.action` + `reason` (COMMIT/DEFER/HOLD) con explicación humana.
- **Contadores L2**: txs totales (`l2.seq`), pendientes, cuentas, próximo lote, raíz de estado (truncada, copiable).
- **Timeline** de lotes: tarjetas con índice, txCount, bytes, estado (`sealed` → `committed` → `finalized`), hash L1 (link a stellar.expert), tiempo desde sellado.
- **Gráfica** de `GET /v1/l1/history`: estado L1 vs. tiempo, superpuesto con lotes publicados. Aquí se ve la tesis.
- Botón "modo demo" (solo con `L1_MODE=mock`): permite cambiar el modo de la L1 simulada. **Requiere** añadir al backend un endpoint admin `POST /v1/admin/mock-l1 { mode }` protegido por token (no existe aún; 10 líneas en `api/server.ts`).

### 3.2 Lote `/batches/:index`
`GET /v1/batches/:i?data=1`: cabecera (raíces, cursor de depósitos, hash de datos, tx L1), lista de txs del lote (decodificar `txData` base64 con `decodeBatchData` del protocolo en el navegador), retiros con `wIndex`. Botón **"Verificar lote"**: reconstruye el estado con `replayBatch` de todos los lotes hasta este y compara raíces → "verified in your browser". Es el argumento de confianza más fuerte que se puede mostrar.

### 3.3 Cuenta `/accounts/:G`
Saldos por token (mostrar símbolo resolviendo el SAC: XLM nativo, USDC…), nonce, historial (`transactions`), estado L1 de cada tx (`finality.l1`).

### 3.4 Transacción `/tx/:id`
Detalle, lote, `finality`, y para retiros: prueba Merkle (`/v1/withdrawals/:id/proof`) con botón "Reclamar en L1" cuando `claimable`.

## 4. Pantallas del Bridge (dapp)

1. **Conectar wallet** (Wallets Kit) → dirección `G…`.
2. **Depositar**: seleccionar token (lista de `network.allowedTokens` o XLM/USDC por defecto), monto → `flash.buildDepositTx` → `wallet.signTransaction` → `server.sendTransaction` → mostrar "acreditando en Flash…" hasta que `GET /v1/accounts/:G` refleje el saldo (poll 1 s; normalmente 5–10 s).
3. **Pagar**: destinatario, token, monto → `signingMessage` → `wallet.signMessage` → `flash.submitSigned` → recibo con `latencyUs` en pantalla (mostrar "confirmado en 3 ms").
4. **Retirar**: monto → `withdraw` (firma SEP-53) → estado del lote → cuando `claimable`, botón "Reclamar" → `buildWithdrawClaimTx` → `signTransaction` → enviar. Explicar el periodo de desafío con cuenta atrás en ledgers.
5. **Saldos** L1 vs. Flash lado a lado.

## 5. Componentes y estados UX importantes

- Mostrar siempre dos niveles de finalidad: **"Confirmado en Flash"** (instante) y **"Liquidado en Stellar"** (lote committed/finalized). Nunca ocultar el segundo: es lo que da confianza.
- Cuando L1 esté DOWN: banner amarillo "Stellar está degradada; tus pagos en Flash siguen confirmándose; los retiros se liquidarán cuando la red vuelva" (texto viene de `l1.reason`).
- Errores 422 del API con mensajes claros: `BAD_NONCE` → "recarga el nonce" (retry automático una vez), `INSUFFICIENT_BALANCE`, `INVALID_SIGNATURE` → "la wallet firmó otro mensaje".
- Enlaces a stellar.expert para `l1TxHash` y para el contrato puente.

## 6. Cambios sugeridos en el backend para el frontend

- Done: `GET /v1/tokens` — metadatos básicos (símbolo XLM testnet/mainnet)
- Done: `GET /v1/stats` — txs/s, latencia, lotes
- Planned: `GET /v1/stream` (SSE) con eventos `tx`, `batch`, `health`
- Planned: `POST /v1/admin/mock-l1` (solo mock) para demo interactiva
- Planned: Rate limiting por IP y API key por app

## 7. Estructura de carpetas propuesta
```
frontend/
  src/
    app/ (router)            pages/ (Live, Batch, Account, Tx, Bridge)
    components/ (L1Badge, BatchCard, FinalityPill, ProofViewer, WalletButton)
    lib/flash.ts (FlashClient singleton)   lib/wallet.ts (Wallets Kit)   lib/verify.ts (replayBatch en navegador)
    hooks/ (useHealth, useBatches, useAccount)
```
Nota: `protocol/src/bytes.ts` usa `node:crypto` y `Buffer`; para el navegador crear `bytes.browser.ts` con `crypto.subtle.digest` y `Uint8Array` (misma API) y resolverlo por condición de export en el paquete.
