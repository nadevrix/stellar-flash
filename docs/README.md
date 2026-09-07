# Stellar Flash · Documentation

**Stellar Flash** is a payment rollup on Stellar: millisecond confirmation with the same `G…` keys and SAC tokens, batched settlement on L1 when the network is healthy.

This folder is the **public, English** documentation for GitHub and demos. Detailed Spanish technical specs remain in the numbered files (`01`–`10`); this README and the English guides below are the presentation layer.

---

## Start here

| Document | Purpose |
|----------|---------|
| [00-START-HERE.md](00-START-HERE.md) | Overview, repo map, quick start |
| [11-product-and-deployment.md](11-product-and-deployment.md) | Live product, URLs, Render ops, troubleshooting |
| [04-arquitectura-tecnica.md](04-arquitectura-tecnica.md) | Architecture (Spanish, technical depth) |
| [06-sequencer-backend.md](06-sequencer-backend.md) | HTTP API reference (Spanish) |
| [07-sdk-integracion.md](07-sdk-integracion.md) | SDK & wallet integration (Spanish) |
| [08-frontend.md](08-frontend.md) | Frontend spec + **implementation status** |
| [10-roadmap.md](10-roadmap.md) | Phases and funding path |

---

## Live testnet (Sep 2026)

| Resource | URL |
|----------|-----|
| App | https://stellar-flash.onrender.com |
| Bridge | https://stellar-flash.onrender.com/bridge |
| Account | https://stellar-flash.onrender.com/account |
| Transactions | https://stellar-flash.onrender.com/explorer |
| Developers | https://stellar-flash.onrender.com/developers |
| Sequencer API | https://stellar-flash-sequencer.onrender.com/v1/health |
| Bridge contract (testnet) | `CBRJ3ILZPY4AUNC5I6SC5FTRA2CJIZJPY5337FO2QO5BQ7HSB2Z7IBB4` |

---

## Quick start (local)

```bash
npm install
npm test
npm run demo              # end-to-end with mock L1
npm start                 # sequencer → http://127.0.0.1:8787/v1/health
cd frontend && npm run dev
```

Requirements: Node ≥ 22.18, Rust + `wasm32v1-none` for the contract.

---

## What ships today

- Soroban `flash-bridge` contract (deposit, batches, Merkle withdraw, escape hatch)
- TypeScript protocol + sequencer (SQLite, L1 health, settlement policy, HTTP API)
- SDK (`FlashClient`) with SEP-53 wallet signing
- Web app: landing, Bridge dapp, Account dashboard, live Explorer, developer docs
- Testnet deployment on Render (sequencer + static frontend)
- 14 automated tests + deposit solvency / anti-infinite-mint checks

---

## License

Apache-2.0 (contract) · MIT (everything else)
