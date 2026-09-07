# 08 · Frontend

> **Status (Sep 2026): SHIPPED** in `frontend/`. Stellar Lab–style UI (sidebar, global wallet, light theme).  
> Public guide: [11-product-and-deployment.md](11-product-and-deployment.md) · [00-START-HERE.md](00-START-HERE.md).

The backend exposes everything needed via JSON HTTP with open CORS. This document describes the web product — most of it is implemented; gaps are marked below.

## 1. Frontend products (priority order)

1. **Flash Explorer + health panel** — done: `/explorer`, `/tx/:id`, `/batches/:index`, `/accounts/:G`
2. **Flash Bridge (user dapp)** — done: `/bridge` (deposit, pay, withdraw, claim)
3. **Account dashboard** — done: `/account` + global wallet in header
4. **Developer console** — done: `/developers` (docs + API); planned: API keys / per-app metrics (Phase 2)

## 2. Stack

- **Vite + React 19 + TypeScript + Tailwind 4**
- Data: **TanStack Query** with 1–2 s `refetchInterval` (SSE planned in Phase 2)
- Wallet: **Stellar Wallets Kit** — Freighter, xBull, Albedo, Lobstr, Hana. Needs `signTransaction` (L1) and `signMessage` (Flash payments, SEP-53; see [07-sdk-integration.md](07-sdk-integration.md))
- Stellar: `@stellar/stellar-sdk` + SDK from this repo
- Charts: Recharts for latency, tx/s, L1 status over time
- Visual identity: black + gold (#FFD100) + violet accents, Stellar Lab–inspired layout

## 3. Explorer screens

### 3.1 Live (`/explorer`)
- **L1 health strip**: HEALTHY/DEGRADED/DOWN with `reason`, `latestLedger`, `ledgerAgeSec`, `feeP90`, endpoint ok/fail and latency from `GET /v1/health` → `l1`
- **Settlement decision**: `settlement.action` + human-readable `reason` (COMMIT/DEFER/HOLD)
- **L2 counters**: total txs, pending, accounts, next batch, state root (truncated, copyable)
- **Batch timeline**: index, txCount, bytes, status (`sealed` → `committed` → `finalized`), L1 tx link
- **L1 history chart**: `GET /v1/l1/history` — the core thesis visualization
- Demo mode button (mock only): requires `POST /v1/admin/mock-l1` — not implemented yet

### 3.2 Batch `/batches/:index`
`GET /v1/batches/:i?data=1`: headers, tx list (decode base64 `txData` with `decodeBatchData`), withdrawals with `wIndex`. **Verify batch** button: `replayBatch` in browser and compare roots — strongest trust argument.

### 3.3 Account `/accounts/:G`
Balances per token, nonce, history, L1 finality per tx.

### 3.4 Transaction `/tx/:id`
Detail, batch link, finality; for withdrawals: Merkle proof + **Claim on L1** when `claimable`.

## 4. Bridge screens (`/bridge`)

1. Connect wallet → `G…` address
2. **Deposit**: token + amount → `buildDepositTx` → `signTransaction` → poll until FXLM balance updates (~5–10 s)
3. **Pay**: recipient, token, amount → SEP-53 sign → submit → show `latencyUs`
4. **Withdraw**: burn FXLM → wait for challenge period → claim on L1 with Merkle proof
5. Side-by-side L1 vs Flash balances

## 5. UX principles

- Always show two finality levels: **"Confirmed on Flash"** (instant) and **"Settled on Stellar"** (batch committed/finalized)
- When L1 is DOWN: yellow banner — Flash payments continue; withdrawals settle when network recovers
- Clear 422 errors: `BAD_NONCE` (auto-retry once), `INSUFFICIENT_BALANCE`, `SELF_TRANSFER`
- Link `l1TxHash` and bridge contract on stellar.expert

## 6. Backend gaps for frontend (Phase 2)

- Planned: `GET /v1/stream` (SSE) for `tx`, `batch`, `health` events
- Planned: `POST /v1/admin/mock-l1` for interactive demo
- Planned: rate limiting and API keys per app

Done: `GET /v1/tokens`, `GET /v1/stats`

## 7. Folder structure (as shipped)

```
frontend/src/
  pages/          Landing, Bridge, Account, Explorer, Developers, Tx, Batch, AccountPublic
  components/     AppShell, wallet, health badges, etc.
  lib/            api client, format helpers, wallet context
```

Note: `protocol/src/bytes.ts` uses `node:crypto`; for in-browser batch verification, add a browser build with `crypto.subtle` (Phase 2).
