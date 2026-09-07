# ⚡ Stellar Flash

**Payment rollup on Stellar — confirmation in milliseconds, settlement on Stellar when the network is healthy.**

Same keys (`G…`), same assets (XLM / USDC via SAC), same security model (funds in a Soroban vault, exits via Merkle proofs). What changes is latency: ~2–6 ms instead of 5–30 seconds. Built for payment apps, bounty platforms, payroll, games, and AI agents.

```
Users / Apps ──SEP-53──▶ Flash Sequencer (~2 ms confirm, batch seal)
                              │ commit_batch (batch data on L1)
                              ▼
                    Stellar L1 · flash-bridge contract (vault, roots, withdraw / escape)
```

## Live testnet

| | |
|---|---|
| **App** | https://stellar-flash.onrender.com |
| **Bridge** | [/bridge](https://stellar-flash.onrender.com/bridge) |
| **API** | https://stellar-flash-sequencer.onrender.com/v1/health |
| **Contract** | `CBRJ3ILZPY4AUNC5I6SC5FTRA2CJIZJPY5337FO2QO5BQ7HSB2Z7IBB4` (testnet) |

## Status (Sep 2026)

- ✅ Soroban `flash-bridge` contract (deposit, batches, Merkle withdraw, escape hatch) — 11 Rust tests
- ✅ Shared protocol (Rust ↔ TS), SEP-53 wallet-compatible signing
- ✅ Sequencer: HTTP API, SQLite persistence, L1 health monitor, settlement policy, RPC failover — 14 TS tests
- ✅ SDK (`FlashClient`) + testnet E2E script
- ✅ **Web app:** landing, Bridge dapp, Account dashboard, live Explorer, developer docs (Stellar Lab–style UI)
- ✅ **Testnet production** on Render (sequencer + static frontend)
- ⏳ Fraud proofs, ZK, API keys, Postgres, npm publish (Phase 2+)

## Quick start

```bash
npm install && npm test && npm run demo
npm start                    # mock L1 → http://127.0.0.1:8787/v1/health
cd frontend && npm run dev   # web UI
```

Requirements: Node ≥ 22.18, Rust + `wasm32v1-none` for the contract.

## Documentation

Start at **[docs/README.md](docs/README.md)** (English, presentation-ready).

Technical deep dives (Spanish): architecture, contracts, sequencer API, SDK — in `docs/01`–`10`.

## Integrate in three lines

```typescript
const receipt = await flash.transfer({
  to: recipientGAddress,
  token: xlmSacContractId,
  amount: 25_000_000n, // stroops
});
// receipt.latencyUs · receipt.finality.l2 === 'instant'
```

## License

[Apache-2.0](contracts/LICENSE) (Soroban contract) · [MIT](LICENSE) (everything else)
