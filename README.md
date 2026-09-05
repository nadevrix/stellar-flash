# ⚡ Stellar Flash

**Rollup de pagos sobre Stellar: confirmación en milisegundos, liquidación en Stellar cuando Stellar está sana.**

Mismas llaves (`G…`), mismos tokens (XLM, USDC vía SAC), misma seguridad (los fondos viven en un contrato Soroban con salidas por prueba Merkle). Otra latencia: ~2 ms en lugar de 5–30 s. Pensado para apps de pagos, plataformas que pagan a muchos (bounties, nóminas), juegos y agentes de IA. Es a Stellar lo que Arbitrum es a Ethereum.

```
Usuarios/Apps ──firma SEP-53──▶ Secuenciador Flash (confirma en ~2 ms, sella lotes)
                                    │ commit_batch (datos del lote en L1)      ▲ getEvents(deposit)
                                    ▼                                          │
                          Stellar L1 · contrato flash-bridge (bóveda, raíces, withdraw/escape)
```

## Estado
- ✅ Contrato Soroban `flash-bridge` (P27, `soroban-sdk` 27.0.6): deposit · commit_batch · withdraw (Merkle) · escape · reclaim_deposit · pause. 11 tests. WASM 18.7 KB.
- ✅ Protocolo compartido Rust ↔ TS (vectores idénticos), firma compatible con SEP-53 (wallets).
- ✅ Secuenciador: API HTTP, log SQLite con recuperación, lotes con límites, monitor de salud L1 (HEALTHY/DEGRADED/DOWN), política de fees/backoff, submitter RPC con failover, watcher de depósitos. 13 tests.
- ✅ SDK drop-in + demo end-to-end (`npm run demo`).
- ✅ **Probado en Stellar testnet**: contrato desplegado, depósito acreditado desde eventos de L1, `commit_batch` real, retiro completo con prueba Merkle y recuperación tras caída del RPC (`node scripts/testnet-e2e.ts`).
- ⏳ Frontend (especificado en `docs/08`), pruebas de fraude y ZK (especificadas en `docs/05`).

## Arranque
```bash
npm install && npm test && npm run demo
npm start        # secuenciador en modo mock: curl localhost:8787/v1/health
```
Requisitos: Node ≥ 22.18 (probado con 26), Rust + `rustup target add wasm32v1-none` para el contrato, `stellar-cli` para desplegar.

## Documentación
Empieza en [`docs/00-EMPIEZA-AQUI.md`](docs/00-EMPIEZA-AQUI.md). Para contribuir: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia
[Apache-2.0](contracts/LICENSE) para el contrato Soroban, [MIT](LICENSE) para el resto.
