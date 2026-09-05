# 05 · Contratos Soroban

Código: `contracts/flash-bridge/src/lib.rs` (≈ 550 líneas) · tests: `src/test.rs` (11 tests) · SDK `soroban-sdk = 27.0.6` (mainnet = Protocolo 27) · target `wasm32v1-none` · WASM ≈ 18.7 KB.

## 1. Comandos

```bash
cd contracts
cargo test                                                       # 11 tests (incluye print_vectors)
cargo test print_vectors -- --nocapture | grep VECTOR             # vectores para comparar con TS
cargo build --target wasm32v1-none --release -p flash-bridge --target-dir target
ls target/wasm32v1-none/release/flash_bridge.wasm
```
Nota: en este entorno el sandbox no deja escribir en `~/.cargo`; si `cargo` falla con "Permission denied" en el registry, ejecutarlo fuera del sandbox.

Verificación cruzada Rust ↔ TS (debe dar "VECTORES IDENTICOS"):
```bash
(cd contracts && cargo test print_vectors -- --nocapture 2>/dev/null | grep VECTOR) > /tmp/r.txt
node scripts/gen-vectors.ts > /tmp/t.txt && diff /tmp/r.txt /tmp/t.txt && echo "VECTORES IDENTICOS"
```

## 2. Interfaz del contrato `FlashBridge`

### Constructor
`__constructor(admin: Address, sequencer: Address, challenge_period_ledgers: u32, liveness_timeout_ledgers: u32)`
Exige `liveness_timeout >= challenge_period` (así, cuando se habilita el escape, el último lote ya está finalizado). Sugerido: testnet 20 / 120; mainnet inicial 8 640 (≈ 12 h) / 17 280 (≈ 24 h); con pruebas de fraude maduras, 7 días como Arbitrum.

### Depósitos
`deposit(from, token, amount: i128, l2_recipient) -> u64` — `from.require_auth()`; transfiere `amount` de `token` a la bóveda; guarda `Deposit(index)`; evento `deposit`. Devuelve el índice.

### Lotes
`commit_batch(batch_index: u64, prev_state_root, new_state_root, withdrawals_root: BytesN<32>, tx_count: u32, deposit_cursor: u64, tx_data: Bytes) -> BytesN<32>` — solo `sequencer`. Comprueba: no pausado, `batch_index == batch_count`, `tx_count > 0`, `prev_state_root` = raíz del lote anterior (o cero), `prev_cursor <= deposit_cursor <= deposit_count`. Guarda `BatchInfo` con `commit_ledger` y devuelve `sha256(tx_data)`. Evento `batch_committed`.

### Retiros
`withdraw(batch_index, w_index: u32, recipient, token, amount, proof: Vec<BytesN<32>>)` — sin auth (cualquiera paga la tx; fondos siempre a `recipient`). Exige lote finalizado (`ledger >= commit_ledger + challenge`), no reclamado, prueba válida. Evento `withdrawn`.

### Emergencia (no se pueden pausar)
- `escape(account, token, balance: i128, nonce: u64, leaf_index: u32, proof)` — solo si `ledger > last_commit_ledger + liveness_timeout`; prueba contra `state_root` del último lote; marca `Escaped`; transfiere `balance` a `account`.
- `reclaim_deposit(index)` — mismo requisito de liveness; solo depósitos con `index >= deposit_cursor` del último lote (o todos si no hay lotes); devuelve al depositante y borra la entrada.

### Admin
`set_sequencer`, `set_admin`, `set_paused(bool)` (pausa deposit/commit/withdraw; **no** escape/reclaim).

### Lecturas
`get_config() -> Config`, `get_batch(i) -> BatchInfo`, `get_deposit(i) -> Option<DepositInfo>`, `batch_finalized(i) -> bool`, `is_claimed(batch, w) -> bool`, `current_state_root() -> BytesN<32>`, `compute_state_leaf(...)`, `compute_withdrawal_leaf(...)` (para que clientes verifiquen su hashing contra el contrato en vivo).

### Errores (`Error`, u32)
1 Paused · 2 InvalidAmount · 3 InvalidBatchIndex · 4 StateRootMismatch · 5 InvalidDepositCursor · 6 BatchNotFound · 7 BatchNotFinalized · 8 AlreadyClaimed · 9 InvalidProof · 10 SequencerAlive · 11 AlreadyEscaped · 12 DepositNotFound · 13 DepositAlreadyProcessed · 14 InvalidConfig · 15 NoBatches · 16 EmptyBatch.

### Eventos (`#[contractevent]`, data en formato map)
| Evento (topic fijo) | Topics | Data |
|---|---|---|
| `deposit` | index | from, token, amount, l2_recipient |
| `batch_committed` | index | state_root, withdrawals_root, tx_data_hash, tx_count, deposit_cursor |
| `withdrawn` | batch_index, w_index | recipient, token, amount |
| `escaped` | batch_index | account, token, balance |
| `deposit_reclaimed` | index | from, token, amount |

### Storage
- Instance: `Admin, Sequencer, ChallengePeriod, LivenessTimeout, Paused, BatchCount, DepositCount, LastCommitLedger` (TTL se extiende en cada escritura: umbral ~15 días → ~30 días).
- Persistent: `Batch(u64)`, `Deposit(u64)`, `Claimed(u64,u32)`, `Escaped(BytesN<32>)` (TTL ~30 → ~60 días; se extiende al leer lotes).
- **Pendiente**: un *keeper* que extienda TTL de lotes antiguos con retiros no reclamados, o exigir reclamar dentro de la ventana de TTL (documentar en UX). Alternativa: guardar solo los últimos N lotes + raíz acumulada.

## 3. Despliegue

### Testnet (script listo)
```bash
export STELLAR_CLI=/ruta/a/stellar     # o instálalo: https://github.com/stellar/stellar-cli/releases (v28.0.0 probado para build)
bash scripts/deploy-testnet.sh
```
El script genera llaves, las fondea con Friendbot, compila, despliega con constructor, hace un depósito de prueba de 10 XLM y escribe `.env` con `L1_MODE=rpc`. Luego:
```bash
set -a; source .env; set +a
node sequencer/src/index.ts
curl -s localhost:8787/v1/health | jq .l1
```
Versiones: `stellar-cli` debe soportar el protocolo de la red (testnet suele ir 1 protocolo por delante de mainnet). Si el deploy falla por versión, usa la release del CLI que coincida con `getVersionInfo.protocolVersion` de `https://soroban-testnet.stellar.org`.

### Manual
```bash
stellar contract deploy --wasm contracts/target/wasm32v1-none/release/flash_bridge.wasm \
  --source $SEQUENCER_SECRET --network testnet \
  -- --admin $ADMIN_G --sequencer $SEQUENCER_G --challenge_period_ledgers 20 --liveness_timeout_ledgers 120
stellar contract id asset --asset native --network testnet          # SAC de XLM
stellar contract invoke --id $BRIDGE --source $USER_SECRET --network testnet -- deposit \
  --from $USER_G --token $XLM_SAC --amount 100000000 --l2_recipient $USER_G
stellar contract invoke --id $BRIDGE --network testnet --source $ANY -- get_config
```
Bindings TypeScript generados (opcional, útiles para el frontend): `stellar contract bindings typescript --contract-id $BRIDGE --network testnet --output-dir sdk/bindings`.

## 4. Fase 2 — especificación de `challenge_batch` (pruebas de fraude) — NO implementado

Objetivo: que un solo observador honesto pueda demostrar on-chain que `new_state_root` de un lote es incorrecto, dentro del periodo de desafío.

Diseño (posible gracias a que la máquina de estado es solo pagos):
1. El retador identifica la primera tx `i` del lote cuyo resultado difiere. Necesita la raíz de estado **intermedia** tras `i-1`. Para hacerlo probable on-chain sin re-ejecutar todo el lote, el secuenciador debe publicar en `commit_batch` un **compromiso de raíces intermedias** (Merkle root de `[root_0, root_1, …, root_n]`) o bien un *checkpoint* cada k txs. Coste: +32 bytes en storage; el retador prueba `root_{i-1}` y `root_i` con pruebas Merkle contra ese compromiso.
2. `challenge_batch(batch_index, tx_index, tx_bytes, pre_root_proof, post_root_proof, from_leaf{balance,nonce,index,proof}, to_leaf{...})`:
   - verifica `tx_bytes` está en `tx_data` (compromiso Merkle sobre las txs del lote: `tx_data_hash` pasa a ser raíz Merkle de las txs, no hash plano);
   - verifica la firma ed25519 (`env.crypto().ed25519_verify`) y el nonce con la hoja `from` probada contra `root_{i-1}`;
   - aplica la transferencia: recalcula hojas `from'`/`to'`, recomputa la raíz sustituyéndolas (usando las mismas pruebas) → `root_i'`;
   - si `root_i' != root_i` publicado → **fraude probado**: el contrato marca el lote como inválido, revierte `batch_count` a `batch_index`, congela al secuenciador (`Paused` para commits) y paga el bond al retador.
3. Requiere: **bond** del secuenciador depositado en el contrato (`stake(amount)`), y `set_sequencer` por gobernanza/admin para reemplazarlo.
4. Depósitos y retiros: los retiros de lotes revertidos quedan sin efecto (no eran finalizados); los depósitos siguen en `Deposit(index)` hasta que un lote válido los acredite.

Esfuerzo estimado: 3–5 días (contrato + tests) + cambios en el secuenciador para publicar raíces intermedias.

## 5. Fase 3 — pruebas de validez (ZK) — NO implementado
- Cambiar hash de hojas/nodos a **Poseidon2** (host `poseidon2_permutation`, feature `hazmat-crypto` del SDK; crate `soroban-poseidon`).
- Circuito (Noir o Circom) que pruebe `new_root = apply(prev_root, txs)` con verificación ed25519 dentro del circuito (caro) **o** firmas EdDSA-Poseidon sobre BabyJubJub (barato, estándar en zkSync Lite/Loopring). Decisión a tomar: mantener llaves Stellar (UX) vs. eficiencia del circuito. Opción intermedia: ed25519 verificado por el secuenciador + prueba de que las firmas fueron verificadas en un zkVM (RISC Zero tiene verificador en Soroban).
- `commit_batch_zk(..., proof)` verifica con `bn254_multi_pairing_check` (Groth16) → el lote es final al instante: retiros en el siguiente ledger.
- Referencias: `NethermindEth/stellar-private-payments` (Groth16 en Soroban, producción), verificador UltraHonk para Soroban, `Errorist79/zkPoR` (P27).

## 6. Fase 4 — inclusión forzada y multi-secuenciador — NO implementado
- `force_include(tx_bytes)`: el usuario deposita su tx L2 en el contrato; el secuenciador debe incluirla en ≤ N ledgers o pierde el derecho a publicar (censura probable on-chain).
- Rotación de secuenciadores con stake y elección por ronda.
