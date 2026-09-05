# 06 · Backend: secuenciador y motor de settlement

Código en `sequencer/src/` (TypeScript ejecutado directamente por Node ≥ 22.18 con *type stripping*; sin build). Reglas compartidas en `protocol/src/`.

## 1. Correr

```bash
npm install
npm test                 # 13 tests (protocolo, secuenciador, política, motor, API, SDK)
npm run typecheck
npm run demo             # demo end-to-end con L1 simulada
npm start                # secuenciador en modo mock (API en http://127.0.0.1:8787)
# Stellar real (tras scripts/deploy-testnet.sh):
set -a; source .env; set +a; npm start
```
Restricciones del *type stripping* de Node: sin `enum`, sin `namespace`, sin *parameter properties*; importar con extensión `.ts`; tipos con `import type`. `tsconfig.json` tiene `erasableSyntaxOnly` para que `tsc` lo vigile.

## 2. Módulos

| Archivo | Qué hace |
|---|---|
| `protocol/src/bytes.ts` | sha256, i128/u64/u32 BE, `encodeAddress` (XDR de `ScVal::Address`), `decodeAddress` |
| `protocol/src/merkle.ts` | hojas/nodos, `buildTree`, `getProof`, `verifyProof` (idéntico al contrato) |
| `protocol/src/tx.ts` | tipos `TransferTx/WithdrawTx/DepositTx`, `domainSeparator`, `signTx`, `verifyTxSignature`, `encodeTx/decodeTx`, `encodeBatchData/decodeBatchData`, `txId`, JSON |
| `protocol/src/state.ts` | `FlashState` (validate/apply, hojas ordenadas, raíz, pruebas, snapshot), `replayBatch` (verificador) |
| `sequencer/src/core/sequencer.ts` | `Sequencer.open` (snapshot + replay del log), `submit`, `ingestDeposit`, `sealBatch` (respeta límites de bytes/txs y recomputa raíz intermedia si parte), `withdrawalProof`, `balanceProof` |
| `sequencer/src/db/store.ts` | SQLite (`node:sqlite`): tablas `transactions`, `batches`, `withdrawals`, `deposits`, `snapshots`, `health_log`, `meta` |
| `sequencer/src/settlement/l1.ts` | interfaz `L1Client` + `MockL1Client` (modos healthy/degraded/down/slow) |
| `sequencer/src/settlement/health.ts` | `evaluateHealth` (pura) + `L1HealthMonitor` (historial, `onChange`) |
| `sequencer/src/settlement/policy.ts` | `decideSettlement` (pura): COMMIT/DEFER/HOLD + puja de fee + backoff |
| `sequencer/src/settlement/engine.ts` | `SettlementEngine.tick`: salud → depósitos → sellar → publicar → finalizar; reconciliación |
| `sequencer/src/settlement/rpc-client.ts` | `StellarRpcL1Client`: probe con fetch, failover, `commit_batch` con `prepareTransaction`/polling, `getEvents` de depósitos, `get_config` por simulación |
| `sequencer/src/api/server.ts` | API HTTP JSON |
| `sequencer/src/config.ts` | variables de entorno (ver `.env.example`) |
| `sequencer/src/index.ts` | arranque: store → sequencer → L1 (mock/rpc) → monitor → engine → API |

## 3. API HTTP (v1)

Todas las respuestas son JSON; los enteros grandes van como string. CORS abierto (`*`) para el frontend.

| Método y ruta | Descripción |
|---|---|
| `GET /v1/health` | `{ l2: {seq, pendingTxs, nextBatch, stateRoot, accounts, depositCursor, lastBatch}, l1: {status, reason, latestLedger, ledgerAgeSec, feeP50, feeP90, surge, endpoints[]}, settlement: {action, maxInclusionFeeStroops, reason}, network: {passphrase, bridgeContractId, l1Mode, allowedTokens} }` |
| `GET /v1/accounts/:G` | `{ balances: [{token, balance, nonce}], transactions: [...] }` |
| `GET /v1/accounts/:G/nonce?token=C…` | `{ nonce }` — para firmar la próxima tx |
| `POST /v1/transactions` | body `{ tx: {type:'transfer'|'withdraw', from, to|l1Recipient, token, amount, nonce, signature(hex)} }` → `201 { receipt: {id, seq, status:'confirmed', finality:{l2:'instant', l1:'pending'}, latencyUs} }`. Errores `422 { error: {code: INVALID_SIGNATURE|BAD_NONCE|INSUFFICIENT_BALANCE|INVALID_AMOUNT|SELF_TRANSFER|TOKEN_NOT_ALLOWED, message, details} }` |
| `GET /v1/transactions/:id` | tx + `finality.l1` (`pending|sealed|committed|finalized`) + lote |
| `GET /v1/batches?limit&offset` · `GET /v1/batches/:i?data=1` | lotes (con `txData` base64 si `data=1`) y retiros del lote |
| `GET /v1/withdrawals/:txId/proof` | `{ batchIndex, wIndex, recipient, token, amount, proof[], withdrawalsRoot, batchStatus, l1TxHash, claimable }` |
| `GET /v1/proofs/balance?account&token` | prueba de saldo contra la raíz actual (escape) |
| `GET /v1/deposits` · `GET /v1/l1/history` | depósitos acreditados; historial de salud L1 |

Ejemplo de flujo con `curl` (modo mock, tras un depósito simulado):
```bash
curl -s localhost:8787/v1/health | jq '{l1: .l1.status, pend: .l2.pendingTxs}'
curl -s "localhost:8787/v1/accounts/$G/nonce?token=$TOKEN"
curl -s -X POST localhost:8787/v1/transactions -H 'content-type: application/json' -d @tx.json
```
Para producir `tx.json` usa el SDK (`sdk/src/index.ts`) o `signTx` del protocolo.

## 4. Persistencia y recuperación

- **Log = fuente de verdad.** `transactions.seq` es monótono; el estado se reconstruye desde `snapshots` + replay. Orden en `submit`: validar → persistir (transacción SQLite) → aplicar al estado. Un fallo de disco rechaza la tx sin dejar el estado adelantado.
- Al arrancar, las txs persistidas sin `batch_index` vuelven a pendientes (reinicio antes de sellar).
- `meta.domain` evita arrancar una DB con otra red/puente.
- `meta.deposit_scan_ledger` es el cursor de escaneo de eventos.

### Recuperación tras divergencia con el contrato
Si `get_config().batch_count != nextBatch` local:
- Contrato adelante (la DB local perdió lotes): restaurar backup de la DB; **nunca** volver a publicar índices ya usados (el contrato los rechaza con `InvalidBatchIndex`; el motor reconcilia marcando `committed`).
- DB adelante (commit que el contrato nunca recibió): los lotes siguen `sealed` y se reintentan; correcto por diseño.
- Raíz distinta con el mismo índice: significa que se publicó un lote con datos distintos de los locales → incidente. Detener, comparar `tx_data` en L1 con el log (`replayBatch`) y decidir.

## 5. Operación en producción (checklist)

- 2–3 RPC en `RPC_URLS` (SDF público + 1–2 de pago o propios; un `stellar-rpc` propio con captive core es lo más robusto).
- `SEQUENCER_SECRET` en un secret manager; cuenta con saldo XLM suficiente para fees (alertar bajo umbral).
- Secuenciador activo/pasivo: un solo proceso publica; el pasivo replica la DB (Postgres streaming) y toma el relevo con el mismo `SEQUENCER_SECRET` o rota con `set_sequencer`.
- Backups de la DB cada minuto (o WAL shipping). Los datos de lotes también están en L1, pero el log completo (txs sin lote) solo está local.
- Métricas: latencia `submit`, txs/s, tamaño de cola, `health_log`, lotes por estado, edad del lote sellado más antiguo (alerta si > 5 min), fee pagada por lote.
- Límites: `MAX_BATCH_BYTES` ≤ 120 000 (margen bajo `tx_max_size_bytes` = 132 096); `MAX_BATCH_TXS` según coste de instrucciones observado en simulación.
- Rate limiting y autenticación por API key para apps (no implementado; ver `10-roadmap.md`).

## 6. Rendimiento y optimizaciones pendientes

Medido en la demo (un hilo, sin optimizar, SQLite en memoria): p50 ≈ 2.2 ms/tx, ~350 tx/s. Cuellos: verificación ed25519 en JS puro (`tweetnacl`), `JSON.stringify` y la transacción SQLite por tx.
1. `sodium-native` (la `stellar-base` lo usa si está instalado) → verificación ~10× más rápida.
2. Persistencia por micro-lotes (agrupar inserts cada 5–10 ms) manteniendo la semántica "confirmado = persistido".
3. Worker threads para verificar firmas en paralelo; el hilo principal solo ordena y aplica.
4. Cache de `encodeAddress` (es determinista) y evitar recalcular hojas de cuentas no tocadas al sellar (árbol incremental).
5. Postgres con `UNLOGGED` para `health_log`.

## 7. Qué falta probar con Stellar real
- `StellarRpcL1Client.commitBatch` end-to-end en testnet (simulación, resource fee, polling, decodificación de errores).
- `fetchDeposits`: forma exacta de `getEvents` en SDK v17 (`ev.topic[]`, `ev.value`, `ev.txHash`) y el parseo del map del `#[contractevent]`.
- Coste real (instrucciones/fees) de `commit_batch` con 60–120 KB de `tx_data` para fijar `MAX_BATCH_BYTES`.
`scripts/deploy-testnet.sh` deja todo listo para esa prueba.
