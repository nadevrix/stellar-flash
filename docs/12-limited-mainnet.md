# 12 · Limited mainnet (pilot)

The public demo stays on **testnet**. Limited mainnet is a **second** sequencer: new contract, new database, new `SEQUENCER_SECRET`, new funded `G…`. Do not point the Render testnet service at Public.

This is not “invulnerable.” Caps and an allowlist bound how much real XLM you can lose. They do not replace an audit or fraud proofs.

## What the code enforces

If `NETWORK_PASSPHRASE` is Public, the process **refuses to start** unless `LIMITED_MAINNET=true`.

Then it requires:

| Variable | Role |
|---|---|
| `ALLOWLIST` | `G…` accounts that may deposit and originate L2 payments. Anyone else is skipped on onramp (XLM stays on the operator — refund by hand). Recipients of a Flash payment do not need to be listed, and they can still withdraw. |
| `ACCOUNT_CAP_STROOPS` | Max FXLM that account may hold after a deposit (default 0.2 XLM). |
| `VAULT_CAP_STROOPS` | Max FXLM outstanding in the whole state (default 1 XLM). |

`GET /v1/health` → `network.limits`. The web app shows a banner and talks to Freighter with the passphrase from health (Main Net vs Test Network).

## Stand up a pilot (manual)

1. Create a **new** Stellar account on Public. Classic payment fees are tiny; **WASM rent is not**. Uploading `flash-bridge` (~19 KB) currently costs ~19.6 XLM of resource fee plus 1 XLM account reserve (~21 XLM on the operator before deploy). Caps below can be cents of XLM; the contract install cannot.
2. Deploy `flash-bridge` on Public (same WASM as testnet). Save the contract id. **Do not** run `scripts/deploy-testnet.sh` against the live testnet sequencer.
3. New Render (or local) service:
   - `DB_PATH` that is **not** the testnet file
   - `NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"`
   - Mainnet Horizon + **two** mainnet Soroban RPCs (not `*testnet*`)
   - `LIMITED_MAINNET=true`
   - `ALLOWLIST` = your wallets
   - caps as above
4. Frontend: `VITE_SEQUENCER_URL` = that API. Keep https://stellar-flash.onrender.com on the testnet sequencer.
5. Freighter → **Main Net**. Deposit a few XLM, pay, withdraw through the contract.

## Building apps on Flash

Testnet is enough to design products. Point `FlashClient` at the testnet URL. When a pilot needs real XLM, point a **separate** client at the limited-mainnet URL. Same SDK.

## What this is not

- Not a WordPress-style “secure rollup template.” Those stacks exist on Ethereum (OP, Orbit); on Stellar this repo **is** the payment-rollup structure.
- Not safer because it is TypeScript. Safety here is isolation, caps, allowlist, and later `challenge_batch`.
- Not KYC. Didit (or similar) belongs when **strangers** deposit or you off-ramp to fiat.
