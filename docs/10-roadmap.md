# 10 · Roadmap and funding path

## 1. Current status (Sep 2026)

**Shipped and tested:**
- Contract, protocol, sequencer, SDK
- **Testnet E2E in production** (Render): deposit, payments, batches, Merkle withdrawal
- **Full web app**: Bridge, Account, Explorer, Developers ([08-frontend.md](08-frontend.md))
- **14 TS tests** + deposit solvency / anti-infinite-mint fix
- Stellar Lab–style UI; public English documentation

**Not yet (Phase 2+):**
- API keys, webhooks, Postgres, SSE
- Fraud proofs, ZK, npm SDK publish
- In-browser batch replay verification

### Phase 0 · Testnet end-to-end — **complete**
See [11-product-and-deployment.md](11-product-and-deployment.md).

### Phase 1 · Demonstrable MVP — **in progress / nearly done**
- Done: Explorer + Bridge deployed on Render
- Done: Landing + usable product
- Planned: Reference bounty integration demo (script `examples/bounty-pay.ts` exists; recorded demo pending)
- Done: English public documentation (Sep 2026)

### Phase 2 · Economic security and revenue (3–6 weeks)
- Plans and billing (Stripe); API keys; L2 tx webhooks
- Fraud proofs (`challenge_batch`) + sequencer bond + intermediate roots in `commit_batch`
- Open-source watchtower CLI (follows contract, replays batches, alerts/challenges)
- Contract audit (SCF/SDF subsidized audit programs)
- Postgres + passive replica; developer metrics
- **Limited mainnet** (deposit caps per account, XLM/USDC)

### Phase 2.5 · State scale and readable signatures
- **Incremental Merkle tree.** Today `root()` rebuilds the full tree each batch (~31 µs per account → wall at ~50–65k accounts with 2 s seal interval). Incremental update → O(log n).
- **Human-readable signing.** Users currently sign binary/hex in wallets. Readable message format ("pay 10 XLM to G…") closes the trust gap.

### Phase 3 · ZK (2–4 months)
- Poseidon2 leaves/nodes; state transition circuit (Noir/Circom) or zkVM with Groth16/UltraHonk verifier on Soroban (BN254, P25)
- `commit_batch_zk`: no challenge period → withdrawals in 1 ledger
- DA compression → ~2 500 tx/s capacity

### Phase 4 · Decentralization and general compute
- Forced inclusion via L1; sequencer rotation with stake
- "Flash VM": run Soroban contracts inside Flash with zkVM validity proofs (Nitro/Stylus analogue)

## 2. Demo script (5 minutes)

1. (30 s) **The problem with data**: RPC incidents, 5–6 s ledgers, surge fees, `tx_bad_seq` on bulk payouts
2. (60 s) **One-line idea**: FXLM. Arbitrum analogy. Architecture diagram ([04-architecture.md](04-architecture.md))
3. (120 s) **Live demo**: deposit → 200 payments in 500 ms → L1 batch → simulate Stellar down → payments still confirm → network returns → batches in order → Merkle withdrawal
4. (45 s) **What exists today**: testnet contract, tests, 3-line SDK `transfer()`
5. (45 s) **Why now**: P25 BN254/Poseidon, no payment rollup on Stellar yet; ask SDF for fraud-proof/ZK mentorship and SCF access

Tips: keep `GET /v1/health` JSON open; show real `latencyUs`; link `l1TxHash` on stellar.expert live.

## 3. Funding

- **Stellar Community Fund (SCF)**: Build Award (~150k USD in XLM tranches) for infrastructure. Requires testnet MVP, roadmap, team, community.
- **SDF grants / infrastructure bounties**: ZK on Stellar (Nethermind Stellar Private Payments, UltraHonk verifier examples).
- **LATAM web3 accelerators / VC**: after Phase 2 (limited mainnet, real metrics).

## 4. Metrics that matter

- L2 confirmation latency p50/p99; sustained tx/s
- Batches published and average XLM cost per 1 000 payments
- Recovery time after RPC outage (seconds until backlog published)
- Integrated apps and daily payments; withdrawals completed and time to `finalized`
- Independent batch verifications (watchtower downloads)
