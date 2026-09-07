# Contributing to Stellar Flash

Thanks for looking at the code. This document covers requirements, how to run everything, invariants you must not break, and stack gotchas.

## 1. Requirements

- **Node ≥ 22.18** (tested with 26). The project uses native type stripping — no TS build step.
- **Rust** with target `wasm32v1-none` (`rustup target add wasm32v1-none`) for the contract.
- **stellar-cli 28.x** only if deploying ([releases](https://github.com/stellar/stellar-cli/releases)).
- Single production dependency: `@stellar/stellar-sdk` ^17.

## 2. Getting started

```bash
npm install
npm test                  # TS tests (protocol, sequencer, SDK)
npm run typecheck         # tsc --noEmit, strict + erasableSyntaxOnly
npm run demo              # end-to-end with simulated L1
npm run contract:test     # Rust contract tests
npm run contract:build    # WASM in contracts/target/wasm32v1-none/release/
npm start                 # sequencer in mock mode → http://127.0.0.1:8787/v1/health
```

Against Stellar testnet:

```bash
bash scripts/deploy-testnet.sh
set -a; source .env; set +a
node sequencer/src/index.ts             # L1_MODE=rpc
node scripts/testnet-e2e.ts             # deposit → pay → batch → Merkle withdraw
```

## 3. Repository map

| Folder | Purpose |
|---|---|
| `contracts/flash-bridge/` | Soroban contract: vault, batch roots, Merkle `withdraw`, escape hatch |
| `protocol/src/` | Shared Rust↔TS rules: `bytes`, `merkle`, `tx`, `state` |
| `sequencer/src/` | Sequencer: `core`, `db`, `settlement`, `api` |
| `sdk/src/` | TypeScript client for integrators |
| `spec/` | Cross-language test vectors |

Public docs: `docs/` (English). Internal Spanish notes live outside this repo.

## 4. Invariants (do not break)

1. **Merkle hashing must be identical in Rust and TS.** If you touch `protocol/src/merkle.ts` or `contracts/flash-bridge/src/lib.rs`, update both **and** `spec/merkle-vectors.txt`:
   ```bash
   node scripts/gen-vectors.ts
   cd contracts && cargo test print_vectors -- --nocapture
   ```
2. **`escape` and `reclaim_deposit` must never be pausable.** Admin cannot block emergency exit — there is a test for this.
3. **Protocol must not depend on Node.** No `node:crypto` or `Buffer` in `protocol/` — it also runs in the browser for wallet signing.
4. **Sequencer must not depend on a single RPC.** Failover and health monitor are mandatory.
5. **Sequencer must start even if Stellar is down.** L2 payments do not require L1; any L1 `await` on startup uses try/catch and background retry.
6. **Order in `submit`: validate → persist → apply.** Log is source of truth.
7. **Single active sequencer.** Two instances signing `commit_batch` corrupt the account sequence.

## 5. Code style

- TypeScript without build: **no `enum`, no parameter properties**; import with `.ts` extension; use `import type`.
- Tests with `node:test`. Stable error names (exposed as `code` by the SDK).
- Domain comments may be in Spanish in source files; public docs are English.

## 6. Stack gotchas

**`@stellar/stellar-sdk` v17**
- XDR enums are **instances, not functions**: `xdr.ScValType.scvAddress` without parentheses.
- `Transaction.hash()` returns `Uint8Array` → `Buffer.from(...).toString('hex')`.
- `getTransaction(...).resultXdr` has no `.result()`: use `resultXdr.toXdrObject()`.

**`soroban-sdk` 27**
- `env.crypto().sha256(&bytes).to_bytes()` → `BytesN<32>`.
- `Address::to_xdr(env)` requires `use soroban_sdk::xdr::ToXdr` and **consumes `self`** (clone first).
- Use `#[contractevent]` instead of deprecated `env.events().publish`.

**Batch limits (testnet, Sep 2026)**
- 250 payments = 54 754 B batch data → 110 416 B Soroban tx (84% of max 132 096 B). Hence `MAX_BATCH_BYTES` = 60 000.
- Cost: ~818 590 stroops (0.082 XLM) per batch ≈ 0.33 XLM per 1 000 payments.
- Reproduce with `node scripts/measure-batch-cost.ts`.

**State root scale limit**
`FlashState.root()` rebuilds the full Merkle tree each seal (~31 µs per account). Wall at ~50–65k accounts with 2 s seal interval. Fix: incremental Merkle (touches contract + protocol + vectors together).

**Stellar RPC**
- `getLatestLedger` response can exceed 4 KB — accumulate chunks before parsing JSON.
- `sendTransaction` returns `PENDING` — poll `getTransaction`.

**Known SAC addresses**
- XLM testnet: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- XLM mainnet: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`

## 7. Before opening a PR

- `npm test` and `npm run typecheck` green; `cargo test` if you touched Rust.
- If you changed codec or hashing, regenerated cross-vectors must match.
- If you changed the contract, state whether it breaks an existing deployment.

## 8. Anchor versions

- Stellar mainnet: **Protocol 27**. Testnet may be one ahead.
- `soroban-sdk` 27.0.6 · `@stellar/stellar-sdk` ^17 · `stellar-cli` 28.x · target `wasm32v1-none`.
