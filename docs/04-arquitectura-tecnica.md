# 04 · Arquitectura técnica

## 1. Decisión: ¿blockchain nueva o rollup?

**Rollup de pagos (L2) sobre Stellar, no una blockchain nueva.** Razones:

- Una cadena nueva necesita validadores, token, seguridad propia, puentes con terceros y años de confianza. Arbitrum no hizo eso: heredó la seguridad de Ethereum.
- Flash hereda la seguridad de Stellar: los fondos viven en un contrato Soroban; la corrección del estado se puede verificar contra los datos publicados en L1; los usuarios salen sin permiso de nadie.
- Empezamos con **rollup de pagos** (estado = saldos + nonces por cuenta y token), no de cómputo general, porque la máquina de estado es simple, determinista y probable (fraude o validez). El 90 % del dolor real son pagos.

## 2. Vista general

```
   Usuarios / Apps (mismas llaves G..., mismos tokens)
          │  firma ed25519 (SEP-53-compatible, ver 07-sdk)
          ▼
 ┌────────────────────────────────────────────────────────────┐
 │  SECUENCIADOR (sequencer/)                                  │
 │  · API HTTP  · FlashState (determinista)  · log SQLite      │
 │  · confirma en < 5 ms  · sella lotes (bytes/txs/tiempo)     │
 │  · SettlementEngine: health monitor + policy + submitter    │
 └──────────────┬─────────────────────────────┬───────────────┘
                │ commit_batch(lote)          │ getEvents(deposit)
                ▼                             │
 ┌────────────────────────────────────────────┴───────────────┐
 │  STELLAR L1 · contrato flash-bridge (Soroban)               │
 │  · bóveda de tokens  · raíces de estado por lote            │
 │  · withdraw(prueba Merkle)  · escape / reclaim_deposit      │
 └────────────────────────────────────────────────────────────┘
                ▲
                │ cualquiera: replayBatch(datos del lote) == raíz publicada
          Verificadores / watchtowers (protocol/)
```

Componentes en el repo:

| Carpeta | Rol | Estado |
|---|---|---|
| `contracts/flash-bridge` | Contrato L1 (Rust/Soroban) | Implementado, 11 tests, WASM 18.7 KB |
| `protocol/` | Reglas compartidas: hashing Merkle, codificación de txs, firma, máquina de estado, replay | Implementado, tests, vectores cruzados con Rust |
| `sequencer/` | Secuenciador: API, log, lotes, salud L1, política, submitter RPC, watcher de depósitos | Implementado (mock L1 probado; RPC real pendiente de prueba en testnet) |
| `sdk/` | Cliente para devs | Implementado (transfer, withdraw, pruebas, helpers L1) |
| `scripts/demo.ts` | Demo end-to-end con L1 simulada | Funciona |

## 3. Modelo de datos del rollup

### 3.1 Identidades y tokens
- Cuenta L2 = dirección Stellar (`G...` ed25519; también `C...` para contratos, sin firma en v0).
- Token = dirección del contrato de token Soroban (`C...`). XLM y activos clásicos se usan vía su **SAC** (Stellar Asset Contract).
- Estado: `(cuenta, token) → { balance: i128, nonce: u64 }`. El nonce es por par (cuenta, token) y protege contra replay.

### 3.2 Árbol Merkle (idéntico en Rust y TS; vectores en `spec/`)
```
leaf_state      = sha256(0x00 || xdr(ScVal(account)) || xdr(ScVal(token)) || balance_i128_be || nonce_u64_be)
node            = sha256(0x01 || left || right)          # hermano faltante = 32 bytes cero
leaf_withdrawal = sha256(0x02 || batch_u64_be || w_index_u32_be || xdr(ScVal(recipient)) || xdr(ScVal(token)) || amount_i128_be)
root(vacío) = 0x00..00 ; root([hoja]) = hoja
```
Las hojas de estado van ordenadas por `xdr(account)||xdr(token)` (orden de bytes). Se usa el XDR de `ScVal::Address` porque es exactamente lo que produce `Address::to_xdr` en Soroban: cero ambigüedad entre implementaciones. Los tags 0x00/0x01/0x02 separan dominios (no hay ataque de segunda preimagen hoja/nodo).

### 3.3 Transacciones L2 (`protocol/src/tx.ts`)
| Tipo | Campos | Firma |
|---|---|---|
| `transfer` (0x10) | from, to, token, amount, nonce | ed25519 de `from` |
| `withdraw` (0x11) | from, l1Recipient, token, amount, nonce | ed25519 de `from` |
| `deposit` (0x12) | depositIndex, to, token, amount, l1TxHash | ninguna (derivada de un evento L1) |

Firma: `sig = ed25519(sha256(domain || body))` con `domain = sha256("stellar-flash-v0" || passphrase_red || xdr(bridge))`. La firma queda ligada a red + despliegue: no hay replay entre testnet/mainnet ni entre dos instancias de Flash.

Codificación del lote: `u32 count || repeat(u16 len || tx_bytes)`. Un `transfer` ocupa 1+44+44+40+16+8+64 = **217 bytes** (219 con longitud). Un lote de 60 KB ≈ 275 transfers; la tx Soroban máxima (132 096 bytes) ≈ 600.

### 3.4 Lote (batch)
```
{ index, prev_state_root, new_state_root, withdrawals_root, tx_count, deposit_cursor, tx_data_hash, tx_data }
```
- `prev_state_root` debe ser la raíz del lote anterior (el contrato lo exige): cadena de estados.
- `deposit_cursor`: depósitos L1 con índice < cursor ya están acreditados en este estado.
- `tx_data` viaja en la tx L1; el contrato guarda `sha256(tx_data)`. **Data availability en L1** desde v0.

## 4. Flujos

### 4.1 Depósito (L1 → L2)
1. Usuario llama `deposit(from, token, amount, l2_recipient)` en el contrato (firma su tx Stellar con su wallet). El contrato mueve los tokens a la bóveda, guarda `Deposit(index)` y emite el evento `deposit`.
2. El secuenciador escanea eventos (`getEvents` con filtro por contrato y topic `deposit`) y llama `ingestDeposit` en orden de índice. Stellar no tiene reorgs: un evento en un ledger cerrado es final (≈ 5 s).
3. El depósito entra al lote como tx tipo `deposit`; el estado suma saldo; `deposit_cursor` avanza.

### 4.2 Pago (L2)
1. La app obtiene el nonce (`GET /v1/accounts/:g/nonce?token=`), construye y firma el `transfer` con la llave del usuario, `POST /v1/transactions`.
2. El secuenciador **valida y ejecuta en el acto** (firma, nonce, saldo), persiste en el log (SQLite, `seq` monótono) y responde con recibo: `status: confirmed, finality: { l2: instant, l1: pending }`. Medido: p50 ≈ 2 ms, ~350 tx/s en un hilo sin optimizar.
3. Al sellar el lote (cada `SEAL_INTERVAL_MS` o al llegar a `MAX_BATCH_BYTES`/`MAX_BATCH_TXS`), se calcula `new_state_root`, `withdrawals_root` y `tx_data`.

### 4.3 Settlement (L2 → L1)
El `SettlementEngine` corre cada `TICK_MS`:
1. **Sondea la salud L1** en todos los RPC (`getLatestLedger`, `getFeeStats`): `HEALTHY` / `DEGRADED` (ledger atrasado ≥ 15 s o fee p90 ≥ umbral de surge) / `DOWN` (nadie responde o ledger ≥ 60 s).
2. **Política** (`policy.ts`, función pura):
   - `DOWN` → `HOLD`: nada se publica, la L2 sigue.
   - `DEGRADED` → `DEFER` si el lote no es urgente; `COMMIT` con puja 2×p90 si tiene retiros o lleva > `MAX_DEFER_MS`.
   - `HEALTHY` → `COMMIT` con puja 1.5×p90 (mínimo/máximo configurables).
   - Tras un fallo: backoff exponencial (5 s, 10 s, 20 s… hasta 2 min) y puja escalada 1.5× por intento.
3. **Submitter** (`rpc-client.ts`): build → `prepareTransaction` (simulación + resource fee) → firma → `sendTransaction` → polling `getTransaction` hasta SUCCESS/FAILED con deadline. Clasifica errores: `NETWORK` (rota de RPC), `TRY_AGAIN_LATER`, `TIMEOUT` (fee insuficiente), `TX_FAILED` (error determinista del contrato, decodificado a nombre: `InvalidBatchIndex`, `StateRootMismatch`…). Si el contrato ya tiene el lote (commit que creímos fallido), **reconcilia** en vez de reintentar.
4. **Finalización**: `committed` → `finalized` cuando `ledger_actual ≥ commit_ledger + CHALLENGE_PERIOD_LEDGERS`.

### 4.4 Retiro (L2 → L1)
1. Usuario firma `withdraw` (quema saldo L2). El secuenciador asigna `w_index` dentro del lote.
2. Cuando el lote está `finalized`, `GET /v1/withdrawals/:txId/proof` devuelve la prueba Merkle.
3. Cualquiera (el usuario, la app, un relayer) llama `withdraw(batch_index, w_index, recipient, token, amount, proof)` en el contrato → tokens a `recipient`. Idempotente (`Claimed`).

### 4.5 Salidas de emergencia (sin cooperación del secuenciador)
- **`escape`**: si el secuenciador lleva > `liveness_timeout` ledgers sin publicar, cualquier cuenta prueba su hoja `(account, token, balance, nonce)` contra la raíz del último lote (ya finalizado) y retira todo. Las pruebas se obtienen del secuenciador si responde, o **de cualquier verificador** que haya reconstruido el estado desde los datos en L1 (`replayBatch`).
- **`reclaim_deposit`**: depósitos con índice ≥ `deposit_cursor` del último lote (nunca acreditados) vuelven al depositante.
- `set_paused` del admin **no** bloquea `escape` ni `reclaim_deposit`.

## 5. Modelo de confianza por fases

| Fase | Confianza en el secuenciador | Garantía |
|---|---|---|
| **v0 (hoy)** | Ordena e incluye txs; podría publicar una raíz falsa | Fondos: seguros (escape con última raíz *finalizada*; datos en L1 para detectar la raíz falsa). Un lote fraudulento se detecta públicamente pero aún no se castiga on-chain. Mitigación: periodo de desafío corto + admin puede pausar y rotar secuenciador; en producción, ventana de desafío larga y **pruebas de fraude** (fase 2). |
| **Fase 2 · pruebas de fraude** | Puede intentar mentir, pero pierde | `challenge_batch(batch, tx_index, pre_state_proofs...)`: el contrato re-ejecuta **una** transferencia con pruebas Merkle de las hojas de origen/destino y compara con la raíz publicada. Si no coincide, revierte el lote y penaliza el bond del secuenciador. Simple porque la máquina de estado es solo pagos. |
| **Fase 3 · pruebas de validez (ZK)** | Ninguna para la corrección | El secuenciador adjunta una prueba Groth16/UltraHonk (BN254 nativo en Soroban desde P25) de que `new_root = f(prev_root, tx_data)`. Sin periodo de desafío: retiros en el siguiente ledger. Merkle con **Poseidon2** (host function) para que el circuito sea barato. |
| **Fase 4 · secuenciador descentralizado** | Ninguna para liveness | Rotación de secuenciadores con stake; **inclusión forzada** vía L1 (el usuario deja su tx en el contrato y debe incluirse en N ledgers). |

## 6. Capacidad y límites (con los números reales de mainnet P27)

| Parámetro | Valor | Implicación |
|---|---|---|
| `tx_max_size_bytes` | 132 096 | ≈ 600 transfers sin comprimir por lote |
| `ledger_max_txs_size_bytes` | 266 240 | ≈ 1 200 transfers/ledger de DA ≈ **240 tx/s** sin compresión |
| Con compresión (índices de cuenta de 4 bytes, sin firmas gracias a ZK) ≈ 20 B/tx | — | ≈ 13 000 tx/ledger ≈ **2 600 tx/s** |
| `fee_tx_size_1kb` | 406 stroops | lote lleno ≈ 0.005 XLM |
| `tx_max_instructions` | 400 M | sha256 de 128 KB y verificación de pruebas caben de sobra |
| Cierre de ledger | 5 000 ms objetivo | latencia L1 de settlement: 1–2 ledgers |

El secuenciador en un hilo sin optimizar hace ~350 tx/s (dominado por verificación ed25519 en JS puro). Con `sodium-native`, verificación por lotes y varios workers, > 5 000 tx/s es realista.

## 7. Modos de fallo y comportamiento

| Fallo | Comportamiento |
|---|---|
| RPC pública caída | Health `DOWN` → `HOLD`. L2 sigue. Al volver, publica lotes en orden (probado en tests y demo). |
| Surge pricing | `DEGRADED` → difiere lo no urgente; publica urgentes con puja alta. |
| Secuenciador se reinicia | Reconstruye estado desde snapshot + log; las txs sin lote vuelven a pendientes. Estado y raíz idénticos (test). |
| Disco falla al persistir | La tx se rechaza **antes** de mutar el estado (orden: validar → persistir → aplicar). |
| Commit "fallido" que sí entró | El contrato responde `InvalidBatchIndex`; el motor **reconcilia** leyendo `get_config`. |
| Secuenciador desaparece | Tras `liveness_timeout`: `escape` + `reclaim_deposit` para todos. |
| Secuenciador publica raíz falsa | Detectable por cualquiera con `replayBatch`. Castigo on-chain: fase 2. |

## 8. Decisiones tomadas y alternativas descartadas

- **SHA-256 en v0** en lugar de Poseidon2: disponible en cualquier lenguaje, rápido en Soroban, sin dependencias. Se cambia a Poseidon2 en la fase ZK (los tags y la estructura del árbol no cambian).
- **Nonce por (cuenta, token)** en lugar de por cuenta: una sola estructura de hoja, pruebas de fraude más simples. Coste: la app debe pedir el nonce por token (trivial).
- **Datos en la tx L1** en lugar de fuera de cadena (validium/IPFS): más caro por byte, pero la seguridad es la de Stellar. Es lo que hace un rollup de verdad.
- **SQLite (`node:sqlite`) en v0**: cero dependencias, suficiente para miles de tx/s. El esquema está pensado para Postgres (ver `09-base-de-datos.md`).
- **Sin framework HTTP**: `node:http` + JSON. Menos superficie, menos deps.
- **Sin firma de depósitos en L2**: el evento L1 ya está autorizado por el depositante.
