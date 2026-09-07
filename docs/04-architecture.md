# 04 · Technical architecture

## 1. Decision: new chain or rollup?

**Payment rollup (L2) on Stellar, not a new blockchain.**

- A new chain needs validators, a native token, its own security model, third-party bridges, and years of trust. Arbitrum did not do that — it inherited Ethereum’s security.
- Flash inherits Stellar’s security: funds live in a Soroban contract; state correctness can be verified against data published on L1; users can exit without anyone’s permission.
- We start with a **payment rollup** (state = balances + nonces per account and token), not general compute, because the state machine is simple, deterministic, and provable (fraud or validity proofs). Most real pain is payments.

## 2. Overview

```
   Users / Apps (same G… keys, same tokens)
          │  ed25519 signature (SEP-53-compatible, see 07-sdk-integration)
          ▼
 ┌────────────────────────────────────────────────────────────┐
 │  SEQUENCER (sequencer/)                                     │
 │  · HTTP API  · FlashState (deterministic)  · SQLite log     │
 │  · confirms in < 5 ms  · seals batches (bytes/txs/time)     │
 │  · SettlementEngine: health monitor + policy + submitter  │
 └──────────────┬─────────────────────────────┬───────────────┘
                │ commit_batch(batch)         │ getEvents(deposit)
                ▼                             │
 ┌────────────────────────────────────────────┴───────────────┐
 │  STELLAR L1 · flash-bridge contract (Soroban)               │
 │  · token vault  · state roots per batch                     │
 │  · withdraw(Merkle proof)  · escape / reclaim_deposit     │
 └────────────────────────────────────────────────────────────┘
                ▲
                │ anyone: replayBatch(batch data) == published root
          Verifiers / watchtowers (protocol/)
```

| Folder | Role | Status |
|---|---|---|
| `contracts/flash-bridge` | L1 contract (Rust/Soroban) | Shipped, 11 tests, 18.7 KB WASM |
| `protocol/` | Shared rules: Merkle hashing, tx encoding, signing, state machine, replay | Shipped, cross-vector tests with Rust |
| `sequencer/` | Sequencer: API, log, batches, L1 health, policy, RPC submitter, deposit watcher | Shipped (mock L1 proven; RPC on testnet) |
| `sdk/` | Developer client | Shipped (transfer, withdraw, proofs, L1 helpers) |
| `scripts/demo.ts` | End-to-end demo with simulated L1 | Works |

## 3. Rollup data model

### 3.1 Identities and tokens
- L2 account = Stellar address (`G…` ed25519; also `C…` for contracts, no signature in v0).
- Token = Soroban token contract address (`C…`). XLM and classic assets use their **SAC** (Stellar Asset Contract).
- State: `(account, token) → { balance: i128, nonce: u64 }`. Nonce is per (account, token) pair and prevents replay.

### 3.2 Merkle tree (identical in Rust and TS; vectors in `spec/`)
```
leaf_state      = sha256(0x00 || xdr(ScVal(account)) || xdr(ScVal(token)) || balance_i128_be || nonce_u64_be)
node            = sha256(0x01 || left || right)          # missing sibling = 32 zero bytes
leaf_withdrawal = sha256(0x02 || batch_u64_be || w_index_u32_be || xdr(ScVal(recipient)) || xdr(ScVal(token)) || amount_i128_be)
root(empty) = 0x00..00 ; root([leaf]) = leaf
```
State leaves are sorted by `xdr(account)||xdr(token)` (byte order). Tags 0x00/0x01/0x02 separate domains (no leaf/node second-preimage attack).

### 3.3 L2 transactions (`protocol/src/tx.ts`)
| Type | Fields | Signature |
|---|---|---|
| `transfer` (0x10) | from, to, token, amount, nonce | ed25519 from `from` |
| `withdraw` (0x11) | from, l1Recipient, token, amount, nonce | ed25519 from `from` |
| `deposit` (0x12) | depositIndex, to, token, amount, l1TxHash | none (derived from L1 event) |

Signature: `sig = ed25519(sha256(domain || body))` with `domain = sha256("stellar-flash-v0" || passphrase_hash || xdr(bridge))`. Bound to network + bridge deployment — no replay across testnet/mainnet or Flash instances.

Batch encoding: `u32 count || repeat(u16 len || tx_bytes)`. One `transfer` is **217 bytes** (219 with length). A 60 KB batch ≈ 275 transfers; max Soroban tx (132 096 bytes) ≈ 600.

### 3.4 Batch
```
{ index, prev_state_root, new_state_root, withdrawals_root, tx_count, deposit_cursor, tx_data_hash, tx_data }
```
- `prev_state_root` must match the previous batch (enforced on-chain).
- `deposit_cursor`: L1 deposits with index < cursor are credited in this state.
- `tx_data` is included in the L1 tx; the contract stores `sha256(tx_data)`. **L1 data availability from v0.**

## 4. Flows

### 4.1 Deposit (L1 → L2)
1. User calls `deposit(from, token, amount, l2_recipient)` on the contract (Stellar tx signed by wallet). Contract moves tokens to vault, stores `Deposit(index)`, emits `deposit` event.
2. Sequencer scans events (`getEvents` filtered by contract + `deposit` topic) and calls `ingestDeposit` in index order. Stellar has no reorgs: an event in a closed ledger is final (~5 s).
3. Deposit enters the batch as a `deposit` tx; state credits balance; `deposit_cursor` advances.

### 4.2 Payment (L2)
1. App fetches nonce (`GET /v1/accounts/:g/nonce?token=`), builds and signs `transfer`, `POST /v1/transactions`.
2. Sequencer **validates and executes immediately** (signature, nonce, balance), persists to log (SQLite, monotonic `seq`), returns receipt: `status: confirmed, finality: { l2: instant, l1: pending }`. Measured: p50 ≈ 2 ms, ~350 tx/s single-threaded unoptimized.
3. On batch seal (`SEAL_INTERVAL_MS` or `MAX_BATCH_BYTES`/`MAX_BATCH_TXS`), computes `new_state_root`, `withdrawals_root`, and `tx_data`.

### 4.3 Settlement (L2 → L1)
`SettlementEngine` runs every `TICK_MS`:
1. **Probes L1 health** on all RPCs (`getLatestLedger`, `getFeeStats`): `HEALTHY` / `DEGRADED` / `DOWN`.
2. **Policy** (`policy.ts`): `DOWN` → `HOLD`; `DEGRADED` → `DEFER` or `COMMIT` with 2×p90 fee; `HEALTHY` → `COMMIT` with 1.5×p90 fee.
3. **Submitter** (`rpc-client.ts`): build → `prepareTransaction` → sign → `sendTransaction` → poll until SUCCESS/FAILED. Reconciles if batch already committed on-chain.
4. **Finalization**: `committed` → `finalized` when `current_ledger ≥ commit_ledger + CHALLENGE_PERIOD_LEDGERS`.

### 4.4 Withdrawal (L2 → L1)
1. User signs `withdraw` (burns L2 balance). Sequencer assigns `w_index` in the batch.
2. When batch is `finalized`, `GET /v1/withdrawals/:txId/proof` returns Merkle proof.
3. Anyone calls `withdraw(batch_index, w_index, recipient, token, amount, proof)` on contract → tokens to recipient. Idempotent (`Claimed`).

### 4.5 Emergency exits (no sequencer cooperation)
- **`escape`**: if sequencer has not published for > `liveness_timeout` ledgers, any account proves its leaf against the last **finalized** batch root and withdraws everything.
- **`reclaim_deposit`**: deposits with index ≥ last batch’s `deposit_cursor` (never credited) return to depositor.
- Admin `set_paused` **does not** block `escape` or `reclaim_deposit`.

## 5. Trust model by phase

| Phase | Sequencer trust | Guarantee |
|---|---|---|
| **v0 (today)** | Orders txs; could publish a false root | Funds safe (escape + L1 data to detect fraud). Fraudulent batch is public but not yet penalized on-chain. |
| **Phase 2 · fraud proofs** | Can lie, but loses bond | `challenge_batch` re-executes one transfer with Merkle proofs and reverts batch if root mismatch. |
| **Phase 3 · ZK validity** | None for correctness | Groth16/UltraHonk proof that `new_root = f(prev_root, tx_data)`. Withdrawals in next ledger. |
| **Phase 4 · decentralized sequencer** | None for liveness | Stake rotation; forced inclusion via L1. |

## 6. Capacity and limits (mainnet P27)

| Parameter | Value | Implication |
|---|---|---|
| `tx_max_size_bytes` | 132 096 | ≈ 600 uncompressed transfers per batch |
| `ledger_max_txs_size_bytes` | 266 240 | ≈ 1 200 transfers/ledger DA ≈ **240 tx/s** uncompressed |
| With compression + ZK | ~20 B/tx | ≈ **2 600 tx/s** |
| Ledger close | 5 000 ms target | L1 settlement latency: 1–2 ledgers |

Unoptimized sequencer: ~350 tx/s (ed25519 in pure JS). With `sodium-native`, batch verification, and workers: > 5 000 tx/s is realistic.

## 7. Failure modes

| Failure | Behavior |
|---|---|
| Public RPC down | Health `DOWN` → `HOLD`. L2 continues. On recovery, publishes batches in order. |
| Surge pricing | `DEGRADED` → defer non-urgent; commit urgent with high fee. |
| Sequencer restart | Rebuilds state from snapshot + log; unbatched txs return to pending. |
| Disk fails on persist | Tx rejected **before** state mutation (validate → persist → apply). |
| “Failed” commit that succeeded | Contract returns `InvalidBatchIndex`; engine reconciles from `get_config`. |
| Sequencer disappears | After `liveness_timeout`: `escape` + `reclaim_deposit` for all. |
| False root published | Detectable via `replayBatch`. On-chain penalty: Phase 2. |

## 8. Design decisions

- **SHA-256 in v0** instead of Poseidon2: portable, fast on Soroban. Switch to Poseidon2 in ZK phase.
- **Nonce per (account, token)**: simpler fraud proofs; app fetches nonce per token.
- **Batch data on L1** instead of off-chain DA: true rollup security model.
- **SQLite in v0**: zero deps, sufficient for thousands of tx/s. Schema ready for Postgres.
- **No HTTP framework**: `node:http` + JSON.
- **No L2 deposit signature**: L1 event is already authorized by depositor.
