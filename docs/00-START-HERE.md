# Stellar Flash · Start here

## What it is

Stellar Flash is a **payment rollup on Stellar**, not a new chain.

- Users deposit XLM (or other allowed SAC tokens) into the `flash-bridge` Soroban contract.
- They receive **FXLM** (1:1, same `G…` address) credited by the sequencer.
- Payments inside Flash confirm in **~2–6 ms** (signed with SEP-53).
- Batches settle on Stellar L1 when the network is healthy.
- Withdrawals burn FXLM and release XLM via Merkle proofs; an **escape hatch** remains available if the sequencer disappears.

**Analogy for judges:** Arbitrum made Ethereum fast; Flash makes Stellar instant for payments.

---

## Architecture (30 seconds)

```
Apps / wallets ──SEP-53──▶ Sequencer (L2 state, instant confirm, batch seal)
                              │ commit_batch + tx data on L1
                              ▼
                    Stellar L1 · flash-bridge contract (vault + roots + withdraw)
```

Trust model today: honest sequencer + on-chain batch data anyone can replay. Fraud proofs and ZK are specified for later phases.

---

## Repository map

```
contracts/flash-bridge/   Soroban contract (Rust)
protocol/src/             Shared rules: merkle, txs, state, replay
sequencer/src/            Sequencer: API, SQLite, settlement, L1 RPC
sdk/src/                  TypeScript client for integrators
frontend/src/             Web app (Vite + React)
examples/                 Integration samples (e.g. bounty payouts)
docs/                     Documentation (this folder)
render.yaml                 Render deployment blueprint
```

---

## Run locally

```bash
npm install
npm test
npm run demo
npm start                 # mock L1 → http://127.0.0.1:8787/v1/health
cd frontend && npm run dev  # http://localhost:5173
```

Testnet contract deploy: see `scripts/deploy-testnet.sh` and `CONTRIBUTING.md`.

---

## Web product (testnet)

| Route | Description |
|-------|-------------|
| `/` | Marketing landing |
| `/bridge` | Connect wallet · deposit · pay · withdraw |
| `/account` | Balances and history for connected wallet |
| `/explorer` | Live payments, batches, L1 health metrics |
| `/developers` | SDK install, API table, integration guide |
| `/tx/:id` | Transaction detail (L2 + L1 finality) |
| `/batches/:index` | Batch detail + Stellar L1 link |
| `/accounts/:address` | Public account view |

UI follows a **Stellar Lab–style** shell: sidebar navigation, testnet badge, global wallet connect.

---

## For integrators

```typescript
import { FlashClient, Keypair } from 'stellar-flash-sdk';

const flash = new FlashClient({
  baseUrl: 'https://stellar-flash-sequencer.onrender.com',
  keypair: Keypair.fromSecret(process.env.SECRET!),
});

const receipt = await flash.transfer({
  to: 'GBXRLWDX…',
  token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  amount: 25_000_000n,
});
// receipt.latencyUs ≈ 6000
// receipt.finality → { l2: 'instant', l1: 'pending' }
```

See [07-sdk-integracion.md](07-sdk-integracion.md) and `/developers` on the live app.

---

## Read next

1. [11-product-and-deployment.md](11-product-and-deployment.md) — production URLs, Render, troubleshooting
2. [04-arquitectura-tecnica.md](04-arquitectura-tecnica.md) — deep architecture
3. [10-roadmap.md](10-roadmap.md) — phases 0–4
