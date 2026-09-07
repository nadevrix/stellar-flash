# 11 · Product & deployment (English)

Public guide for demos, judges, and operators. **No secrets** in this document — configure those in your hosting provider's environment panel.

---

## 1. Live testnet deployment

| Component | Service (Render) | URL |
|-----------|------------------|-----|
| Web app | `stellar-flash` (Static Site) | https://stellar-flash.onrender.com |
| Sequencer | `stellar-flash-sequencer` (Web Service, Node, Oregon) | https://stellar-flash-sequencer.onrender.com |
| Health check | — | `GET /v1/health` |
| Bridge contract | Soroban on Stellar testnet | `CBRJ3ILZPY4AUNC5I6SC5FTRA2CJIZJPY5337FO2QO5BQ7HSB2Z7IBB4` |

The static site is a SPA: all routes (`/bridge`, `/explorer`, …) rewrite to `index.html`.

---

## 2. User-facing product

### Bridge (`/bridge`)
1. Connect wallet (Freighter, xBull, Lobstr, Albedo, Hana, Rabet) on **testnet**
2. **Deposit** — Stellar transaction (~5 s); XLM locked in contract; FXLM credited by sequencer
3. **Pay** — instant FXLM transfer to another `G…` address (not yourself)
4. **Withdraw** — burn FXLM; after challenge period, **claim** XLM on L1 with Merkle proof

### Account (`/account`)
Dashboard for the connected wallet: FXLM balances, nonce, transaction history, links to Bridge.

### Transactions (`/explorer`)
Live feed of L2 payments, batch settlement status, Stellar RPC health probes, latency and throughput stats.

### Developers (`/developers`)
SDK install snippet, HTTP API table, integration patterns, link to `examples/bounty-pay.ts`.

---

## 3. Where FXLM lives

FXLM is **not** a Stellar asset in the user's wallet. Balances live in the **sequencer's L2 state** (SQLite on a persistent disk), keyed by Stellar address.

Freighter holds **XLM on L1** and signs:
- Stellar transactions for deposit and withdraw claim
- SEP-53 messages for Flash payments

---

## 4. Render deployment architecture

Defined in `render.yaml`:

### Sequencer (`stellar-flash-sequencer`)
- **Plan:** Starter (required for persistent disk)
- **Disk:** 1 GB at `/var/data` → `DB_PATH=/var/data/flash.db`
- **Build filter:** `sequencer/**`, `protocol/**`, `package.json` only
- **Build:** `npm ci --omit=dev`
- **Start:** `node sequencer/src/index.ts`
- **Health:** `/v1/health`

### Frontend (`stellar-flash`)
- **Build filter:** `frontend/**`, `sdk/**`, `protocol/**`
- **Build:** `npm ci --omit=dev && cd frontend && npm ci && npm run build`
- **Publish:** `frontend/dist`

**Important:** If the sequencer service was created manually before `render.yaml`, environment variables from the YAML are **not** automatically applied. Set them in the Render dashboard.

---

## 5. Required environment variables (sequencer)

| Variable | Example / notes |
|----------|-----------------|
| `L1_MODE` | `rpc` |
| `API_HOST` | `0.0.0.0` (Render requires public bind) |
| `DB_PATH` | `/var/data/flash.db` |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `RPC_URLS` | Two comma-separated Soroban RPC endpoints |
| `ALLOWED_TOKENS` | XLM SAC contract id on testnet |
| `BRIDGE_CONTRACT_ID` | Deployed contract id |
| `SEQUENCER_SECRET` | Sequencer signing key (S…) |
| `DEPOSIT_SCAN_START_LEDGER` | Ledger height when contract was deployed |
| `CHALLENGE_PERIOD_LEDGERS` | `20` |

### PaaS auto-detection (since commit `8c01a4b`)

When `PORT` is set (Render always sets this):
- Binds to `0.0.0.0` unless `API_HOST` is explicit
- Defaults DB to `/var/data/flash.db`
- Uses `rpc` mode if `SEQUENCER_SECRET` is present

---

## 6. Troubleshooting

### Deploy failed: "No open ports detected on 0.0.0.0"

**Symptom:** Build succeeds, then 15-minute timeout; logs show `127.0.0.1:10000` and `L1=mock`.

**Cause:** Sequencer bound to localhost; Render cannot route traffic.

**Fix:** Deploy commit `8c01a4b` or later; set `API_HOST=0.0.0.0` and full env vars in dashboard.

### Health check timeout

Same root cause as above. Successful startup log:

```
Stellar Flash sequencer · L1=rpc · API http://0.0.0.0:10000/v1/health · DB /var/data/flash.db
```

### Frontend shows "Connecting…" / Account errors

Sequencer is down or last deploy failed. Check `GET /v1/health`. Restart **`stellar-flash-sequencer`**, not the static site.

### Freighter "malicious" warning

New Render domain; Freighter cannot scan the site yet. Use **Testnet** network in Freighter. Testnet assets have no value.

### Pay to yourself fails

Protocol rejects `SELF_TRANSFER`. Use a different testnet `G…` address.

### Frontend build on Render

Must install root dependencies first (SDK/protocol imports). Build command is in `render.yaml`.

---

## 7. Manual operations on Render

1. Open dashboard → search `stellar-flash-sequencer` (`Ctrl+K` / `Cmd+K`)
2. Tab **Deploys** → **Manual Deploy** → **Deploy latest commit**
3. Watch **Logs** for successful bind on `0.0.0.0`
4. Confirm status **Live** (green)

Do **not** confuse with `stellar-flash` (Static) — that only redeploys the web UI.

---

## 8. Security notes (testnet)

- Deposit credits require verified L1 events + solvency check (anti infinite-mint)
- Use **two RPC endpoints** in `RPC_URLS` for failover
- Rotate `SEQUENCER_SECRET` if leaked — it can sign `commit_batch`
- Challenge period is an emergency window today; cryptographic fraud proofs are Phase 2

---

## 9. Not yet shipped (Phase 2+)

- Developer dashboard with API keys and per-app metrics
- `npm publish` of `stellar-flash-sdk`
- In-browser batch replay verification
- SSE `/v1/stream` for live updates
- Postgres, webhooks, fraud proofs, ZK

See [10-roadmap.md](10-roadmap.md).

---

## 10. Demo script (5 min)

1. Show **Explorer** — live payments, ~6 ms latency, L1 health strip
2. Open **Bridge** — connect Freighter testnet, deposit small XLM
3. **Pay** another address — show instant confirmation
4. **Account** — balance and history
5. Mention contract on stellar.expert + open `/developers` for integrators
