# Cómo contribuir a Stellar Flash

Gracias por mirar el código. Este documento reúne lo que necesitas para no perder tiempo:
requisitos, cómo correr todo, invariantes que no se pueden romper y los gotchas del stack.

## 1. Requisitos

- **Node ≥ 22.18** (probado con 26). El proyecto usa *type stripping* nativo: no hay build de TS.
- **Rust** con el target `wasm32v1-none` (`rustup target add wasm32v1-none`) para el contrato.
- **stellar-cli 28.x** solo si vas a desplegar ([releases](https://github.com/stellar/stellar-cli/releases)).
- Una sola dependencia de producción: `@stellar/stellar-sdk` ^17.

## 2. Arrancar

```bash
npm install
npm test                  # tests TS (protocolo, secuenciador, SDK)
npm run typecheck         # tsc --noEmit, strict + erasableSyntaxOnly
npm run demo              # demo end-to-end con L1 simulada
npm run contract:test     # tests Rust del contrato
npm run contract:build    # WASM en contracts/target/wasm32v1-none/release/
npm start                 # secuenciador en modo mock → http://127.0.0.1:8787/v1/health
```

Contra Stellar testnet real:

```bash
bash scripts/deploy-testnet.sh          # despliega el contrato y escribe .env
set -a; source .env; set +a
node sequencer/src/index.ts             # secuenciador en L1_MODE=rpc
node scripts/testnet-e2e.ts             # depósito → pago → lote → retiro con prueba Merkle
```

## 3. Mapa del repo

| Carpeta | Qué es |
|---|---|
| `contracts/flash-bridge/` | Contrato Soroban (Rust): bóveda, raíces de lote, `withdraw` con Merkle, escape hatch |
| `protocol/src/` | Reglas compartidas Rust↔TS: `bytes`, `merkle`, `tx`, `state`. Es la máquina de estado |
| `sequencer/src/` | Secuenciador: `core`, `db`, `settlement` (health/policy/engine/rpc), `api` |
| `sdk/src/` | Cliente TS para integradores |
| `spec/` | Vectores de prueba cruzados Rust↔TS |

## 4. Invariantes que no se pueden romper

1. **El hashing Merkle es idéntico en Rust y en TS.** Si tocas `protocol/src/merkle.ts` o `contracts/flash-bridge/src/lib.rs`, actualiza los dos **y** `spec/merkle-vectors.txt`, y comprueba que coinciden byte a byte:
   ```bash
   node scripts/gen-vectors.ts
   cd contracts && cargo test print_vectors -- --nocapture
   ```
2. **`escape` y `reclaim_deposit` nunca se pueden pausar.** El admin no puede bloquear la salida de emergencia; hay un test que lo verifica. Es lo que hace que el sistema no sea custodial.
3. **El protocolo no puede depender de Node.** Nada de `node:crypto` ni `Buffer` en `protocol/`:
   ese código corre también en el navegador, donde la dapp construye el mensaje que firma la wallet.
   Que lo construya el cliente es lo que impide que un backend malicioso te haga firmar otro pago.
4. **El secuenciador no puede depender de un solo RPC.** Failover y monitor de salud son obligatorios; un endpoint caído no puede tumbar el servicio.
5. **El secuenciador debe arrancar aunque Stellar esté caída.** Los pagos L2 no dependen de la L1; los lotes esperan. Cualquier `await` a la L1 en el arranque va con `try/catch` y reintento en segundo plano.
6. **Orden en `submit`: validar → persistir → aplicar.** El log es la fuente de verdad; el estado en memoria se reconstruye desde él.
7. **Un solo secuenciador.** Dos instancias firmando `commit_batch` corrompen la secuencia de la cuenta. El despliegue debe ser de instancia única.

## 5. Estilo de código

- TypeScript sin build: **no uses `enum`, ni parameter properties**, importa con extensión `.ts` y usa `import type`. Node no hace type stripping dentro de `node_modules`, por eso los paquetes internos se importan por ruta relativa en vez de con workspaces.
- Tests con `node:test`. Nombres de error estables (el SDK los expone como `code`).
- Comentarios en español en las piezas de dominio, explicando el *por qué*, no el *qué*.

## 6. Gotchas del stack (ahorran horas)

**`@stellar/stellar-sdk` v17**
- Los enums XDR son **instancias, no funciones**: `xdr.ScValType.scvAddress` sin paréntesis.
- `Transaction.hash()` devuelve `Uint8Array` → `Buffer.from(...).toString('hex')`.
- Para diagnosticar envíos rechazados: `sendTransaction().errorResult.toXDR('base64')`.
- `getTransaction(...).resultXdr` **no tiene `.result()`**: usa `resultXdr.toXdrObject()`, que devuelve
  un objeto plano donde `feeCharged` es una **propiedad**, no un método.

**`soroban-sdk` 27**
- `env.crypto().sha256(&bytes).to_bytes()` → `BytesN<32>`.
- `Address::to_xdr(env)` requiere `use soroban_sdk::xdr::ToXdr` y **consume `self`** (clona antes).
- `env.events().publish` está deprecado → usa `#[contractevent]` (el topic es el nombre en snake_case).
- Tests: `env.register(Contract, (args…))`, `env.register_stellar_asset_contract_v2(admin)`, `env.ledger().with_mut(|l| l.sequence_number += n)`.

**Límites de lote (medidos en testnet, sep-2026)**
- Un lote de 250 pagos = 54 754 B de datos → transacción Soroban de **110 416 B** (2,02x de overhead
  XDR), el 84 % del máximo por transacción (132 096 B). Por eso `MAX_BATCH_BYTES` es 60 000.
- Coste real: **818 590 stroops (0,082 XLM) por lote**, es decir **0,33 XLM por cada 1000 pagos**.
- Capacidad de publicación: caben 2 lotes así por ledger → **~100 pagos/s sostenidos** en L1 hoy.
  La confirmación en L2 es mucho más rápida; el techo está en la disponibilidad de datos, y es lo
  que ataca la fase ZK con compresión. Reproducir con `node scripts/measure-batch-cost.ts`.

**Stellar RPC**
- La respuesta de `getLatestLedger` supera los 4 KB (lleva `metadataXdr`), así que llega **en varios chunks**: acumula stdin antes de parsear o tendrás un `Unterminated string in JSON`.
- `sendTransaction` devuelve `PENDING`, no éxito: hay que hacer polling de `getTransaction`.

**SAC conocidos**
- XLM testnet: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- XLM mainnet: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`

## 7. Antes de abrir un PR

- `npm test` y `npm run typecheck` en verde; `cargo test` si tocaste Rust.
- Si cambiaste el codec o el hashing, los vectores cruzados regenerados y coincidiendo.
- Si cambiaste el contrato, di explícitamente si rompe compatibilidad con un despliegue existente.

## 8. Versiones ancla

- Stellar mainnet: **Protocolo 27**. Testnet puede ir un protocolo por delante (28 al momento de escribir).
- `soroban-sdk` 27.0.6 · `@stellar/stellar-sdk` ^17 · `stellar-cli` 28.x · target `wasm32v1-none`.
