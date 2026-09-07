# 07 · SDK and developer integration

Code: `sdk/src/index.ts` · tests: `sdk/src/sdk.test.ts`

## 1. Drop-in promise

Before (Stellar L1):
```ts
const tx = new TransactionBuilder(account, { fee, networkPassphrase })
  .addOperation(Operation.payment({…})).setTimeout(30).build();
tx.sign(kp);
await server.sendTransaction(tx);  // PENDING… polling, TRY_AGAIN_LATER, tx_bad_seq…
```

After (Flash):
```ts
import { FlashClient } from 'stellar-flash-sdk';
const flash = new FlashClient({ baseUrl: 'https://stellar-flash-sequencer.onrender.com', keypair: kp });
const receipt = await flash.transfer({ to: 'G…', token: XLM_SAC, amount: 25_000_000n });
// receipt.latencyUs ≈ 6000 — confirmed in milliseconds
```

Same `Keypair`, same SAC token addresses, no sequence numbers, no fee tuning per payment.

## 2. Client API

| Method | Description |
|---|---|
| `health()` | L2/L1 status and network config |
| `getAccount(g)` / `getBalance(g, token)` / `getNonce(g, token)` | Read state |
| `transfer({ to, token, amount, nonce? })` | Sign with keypair and submit |
| `withdraw({ token, amount, l1Recipient?, nonce? })` | Burn on L2; claim on L1 later |
| `submitSigned(txJson)` | Submit wallet-signed tx |
| `getTransaction(id)` / `waitForL1(id, 'committed'|'finalized')` | Track L1 finality |
| `getWithdrawalProof(txId)` | Merkle proof for claim |
| `buildDepositTx({ server, from, token, amount, l2Recipient? })` | Unsigned Stellar deposit tx |
| `buildWithdrawClaimTx({ server, source, proof })` | Unsigned L1 withdraw claim tx |

Errors: `FlashApiError { status, code, message, details }` — `INVALID_SIGNATURE`, `BAD_NONCE`, `INSUFFICIENT_BALANCE`, `SELF_TRANSFER`, `TOKEN_NOT_ALLOWED`, etc.

## 3. Wallet signing (Freighter, etc.) — SEP-53

Flash signs `sha256("Stellar Signed Message:\n" || domain || body)` with ed25519 — **SEP-53**, supported by Stellar wallets.

Frontend flow (no secret key exposure):
```ts
import { signingMessage, txToJson, domainSeparator } from '@stellar-flash/protocol';
const net = await flash.network();
const domain = domainSeparator({ networkPassphrase: net.passphrase, bridgeContractId: net.bridgeContractId });
const unsigned = { type: 'transfer', from, to, token, amount, nonce: await flash.getNonce(from, token) };
const message = signingMessage(unsigned, domain);
const signature = await wallet.signMessage(message, { address: from });
await flash.submitSigned(txToJson({ ...unsigned, signature }));
```

## 4. Integration patterns

**Bulk payouts (bounties, payroll):**
```ts
for (const p of payouts) await flash.transfer({ to: p.address, token: USDC, amount: p.amount });
// N payments in N × ~3 ms. One L1 batch settles all.
```

**Checkout / POS:** Customer wallet signs SEP-53; merchant polls account or listens for confirmation in < 1 s.

**Games / micropayments:** Each action = small `transfer`. 350+ tx/s per sequencer unoptimized.

**AI agents:** Agent holds a `Keypair`; pays per task with `transfer`; verifies with `getTransaction`.

See `examples/bounty-pay.ts` for a reference script.

## 5. Deposit and withdraw step by step

```ts
import { rpc } from '@stellar/stellar-sdk';
const server = new rpc.Server('https://soroban-testnet.stellar.org');

// 1) L1 → L2
const dep = await flash.buildDepositTx({ server, from: kp.publicKey(), token: XLM_SAC, amount: 100_0000000n });
dep.sign(kp); await server.sendTransaction(dep);

// 2) L2 → L1
const w = await flash.withdraw({ token: XLM_SAC, amount: 10_0000000n });
await flash.waitForL1(w.id, 'finalized');
const proof = await flash.getWithdrawalProof(w.id);
const claim = await flash.buildWithdrawClaimTx({ server, source: kp.publicKey(), proof });
claim.sign(kp); await server.sendTransaction(claim);
```

## 6. npm publish (planned)

Split `protocol/` and `sdk/` as `@stellar-flash/protocol` and `@stellar-flash/sdk` with ESM+CJS build (tsup). Browser build: replace `node:crypto` with `crypto.subtle` in `protocol/src/bytes.ts`.
