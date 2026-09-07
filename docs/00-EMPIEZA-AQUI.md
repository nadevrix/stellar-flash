# Stellar Flash · Documentación — empieza aquí

> **Documentación pública en inglés (GitHub / demos):** [`README.md`](README.md) · [`00-START-HERE.md`](00-START-HERE.md) · [`11-product-and-deployment.md`](11-product-and-deployment.md)

**Stellar Flash** es un rollup de pagos (L2) sobre Stellar: confirmación en milisegundos con las mismas llaves y tokens de Stellar, y liquidación en L1 por lotes cuando la red está sana. Producto único: **FXLM / FUSDC** (XLM/USDC puenteados 1:1).

## Orden de lectura

| # | Documento | Para qué |
|---|---|---|
| 01 | [Diagnóstico del problema](01-diagnostico-problema.md) | Por qué "Stellar se laguea" de verdad (con datos e incidentes) y qué arregla Flash |
| 02 | [Arbitrum: historia y lecciones](02-arbitrum-historia-y-lecciones.md) | Cómo nació y se presentó Arbitrum; qué copiamos y qué tenemos más fácil en Stellar |
| 04 | [Arquitectura técnica](04-arquitectura-tecnica.md) | Rollup vs. blockchain, componentes, Merkle, txs, flujos, modelo de confianza por fases, límites reales |
| 05 | [Contratos Soroban](05-contratos-soroban.md) | Interfaz del contrato, despliegue, especificación de pruebas de fraude/ZK (fases 2–3) |
| 06 | [Backend: secuenciador](06-sequencer-backend.md) | Módulos, API HTTP, persistencia, operación, rendimiento |
| 07 | [SDK e integración](07-sdk-integracion.md) | Uso del SDK, firma con wallets (SEP-53), patrones |
| 08 | [Frontend](08-frontend.md) | Qué construir, stack, pantallas, cambios de backend necesarios |
| 09 | [Base de datos](09-base-de-datos.md) | Esquema, invariantes, migración a Postgres |
| 10 | [Roadmap](10-roadmap.md) | Estado, fases y camino a financiación |
| — | [Cómo contribuir](../CONTRIBUTING.md) | Requisitos, invariantes que no se pueden romper, gotchas del stack |

## Arranque rápido

```bash
npm install
npm test                  # tests TS
npm run demo              # demo end-to-end (L1 simulada)
npm run contract:test     # tests Rust del contrato
npm start                 # secuenciador modo mock → http://127.0.0.1:8787/v1/health
```

Contra testnet real: ver [`CONTRIBUTING.md`](../CONTRIBUTING.md) §2.

## Mapa del repo

```
contracts/flash-bridge/     contrato Soroban (Rust) + tests
protocol/src/               reglas compartidas (bytes, merkle, tx, state) + tests
sequencer/src/              secuenciador: core, db, settlement, api, config, index
sdk/src/                    cliente TS para devs + test
scripts/                    demo.ts, gen-vectors.ts, deploy-testnet.sh, testnet-e2e.ts
spec/                       vectores de prueba cruzados
docs/                       esta documentación
```
