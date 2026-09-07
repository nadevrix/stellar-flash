# 06 · Sequencer backend and HTTP API

Code lives in `sequencer/src/` (TypeScript run directly by Node ≥ 22.18 with type stripping; no build step). Shared rules in `protocol/src/`.

## 1. Run

```bash
npm install
npm test                 # 14 tests (protocol, sequencer, policy, engine, API, SDK)
npm run typecheck
npm run demo             # end-to-end demo with simulated L1
npm start                # sequencer in mock mode → http://127.0.0.1:8787
# Stellar testnet (after scripts/deploy-testnet.sh):
set -a; source .env; set +a; npm start
```

Node type-stripping constraints: no `enum`, no `namespace`, no parameter properties; import with `.ts` extension; use `import type`. `tsconfig.json` sets `erasableSyntaxOnly`.

## 2. Modules

| File | Purpose |
|---|---|
| `protocol/src/bytes.ts` | sha256, i128/u64/u32 BE, `encodeAddress`, `decodeAddress` |
| `protocol/src/merkle.ts` | leaves/nodes, `buildTree`, `getProof`, `verifyProof` |
| `protocol/src/tx.ts` | tx types, `domainSeparator`, `signTx`, `verifyTxSignature`, encode/decode |
| `protocol/src/state.ts` | `FlashState`, `replayBatch` |
| `sequencer/src/core/sequencer.ts` | `open`, `submit`, `ingestDeposit`, `sealBatch`, proofs |
| `sequencer/src/db/store.ts` | SQLite persistence |
| `sequencer/src/settlement/` | L1 client, health, policy, engine, RPC client |
| `sequencer/src/api/server.ts` | HTTP JSON API |
| `sequencer/src/config.ts` | environment variables (see `.env.example`) |

## 3. HTTP API (v1)

All responses are JSON; large integers are strings. CORS is open (`*`) for the web app.

| Method & path | Description |
|---|---|
| `GET /v1/health` | L2 counters, L1 health probes, settlement decision, network config |
| `GET /v1/accounts/:G` | Balances, nonces, transaction history |
| `GET /v1/accounts/:G/nonce?token=C…` | Next nonce for signing |
| `POST /v1/transactions` | Submit signed `transfer` or `withdraw` → receipt with `latencyUs` |
| `GET /v1/transactions/:id` | Tx detail + L1 finality |
| `GET /v1/batches?limit&offset` · `GET /v1/batches/:i?data=1` | Batch list/detail (base64 `txData` if `data=1`) |
| `GET /v1/withdrawals/:txId/proof` | Merkle proof for L1 claim |
| `GET /v1/proofs/balance?account&token` | Balance proof for escape hatch |
| `GET /v1/tokens` | Token metadata (symbol) |
| `GET /v1/stats` | Throughput and latency stats |
| `GET /v1/deposits` · `GET /v1/l1/history` | Credited deposits; L1 health history |

**POST /v1/transactions** body:
```json
{
  "tx": {
    "type": "transfer",
    "from": "G…",
    "to": "G…",
    "token": "C…",
    "amount": "25000000",
    "nonce": "0",
    "signature": "hex…"
  }
}
```

Errors `422`: `INVALID_SIGNATURE`, `BAD_NONCE`, `INSUFFICIENT_BALANCE`, `INVALID_AMOUNT`, `SELF_TRANSFER`, `TOKEN_NOT_ALLOWED`.

Example with curl (mock mode):
```bash
curl -s localhost:8787/v1/health | jq '{l1: .l1.status, pend: .l2.pendingTxs}'
curl -s "localhost:8787/v1/accounts/$G/nonce?token=$TOKEN"
curl -s -X POST localhost:8787/v1/transactions -H 'content-type: application/json' -d @tx.json
```

Use the SDK or `signTx` from the protocol to build `tx.json`.

## 4. Persistence and recovery

- **Log is source of truth.** `transactions.seq` is monotonic; state rebuilds from snapshots + replay. Order in `submit`: validate → persist (SQLite transaction) → apply to state.
- On startup, persisted txs without `batch_index` return to pending.
- `meta.domain` prevents opening a DB from another network/bridge.

### Recovery after contract divergence
If `get_config().batch_count != local nextBatch`:
- Contract ahead (DB lost batches): restore DB backup; never republish used indices.
- DB ahead (commit never landed): batches stay `sealed` and retry — correct by design.
- Same index, different root: stop, compare L1 `tx_data` with local log via `replayBatch`.

## 5. Production checklist

- 2–3 RPC endpoints in `RPC_URLS`.
- `SEQUENCER_SECRET` in a secret manager; fund account for fees.
- Single active sequencer (two instances corrupt `commit_batch` sequence).
- DB backups every minute. Batch data is also on L1; full unbatched log is local only.
- Metrics: submit latency, tx/s, queue depth, batch age, fees paid.
- `MAX_BATCH_BYTES` ≤ 120 000 (margin under Soroban max 132 096).
- Rate limiting and API keys: planned (Phase 2).

## 6. Performance

Measured (single thread, unoptimized, in-memory SQLite): p50 ≈ 2.2 ms/tx, ~350 tx/s. Bottlenecks: ed25519 in JS, SQLite transaction per tx.

Planned optimizations: `sodium-native`, micro-batch persistence, worker threads for signature verification, incremental Merkle tree, Postgres for `health_log`.

## 7. Stellar testnet validation

- `StellarRpcL1Client.commitBatch` end-to-end on testnet.
- `fetchDeposits` event parsing with SDK v17.
- Real instruction/fee cost for 60–120 KB batches to tune `MAX_BATCH_BYTES`.

Run `scripts/deploy-testnet.sh` and `scripts/testnet-e2e.ts` for a full flow.
