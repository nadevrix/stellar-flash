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
| `withdraw({ token, amount, l1Recipient?, nonce? })` | Burn on L2; sequencer pays XLM after the batch finalizes |
| `submitSigned(txJson)` | Submit wallet-signed tx |
| `getTransaction(id)` / `waitForL1(id, 'committed'|'finalized')` | Track L1 finality |
| `getWithdrawalProof(txId)` | Merkle proof; `claimed` once we paid XLM |
| `buildDepositTx` / `buildWithdrawClaimTx` | Optional: talk to the contract yourself (watchtowers) |

Errors: `FlashApiError { status, code, message, details }` — `INVALID_SIGNATURE`, `BAD_NONCE`, `INSUFFICIENT_BALANCE`, `SELF_TRANSFER`, `TOKEN_NOT_ALLOWED`, etc.

## 3. Wallet signing (Freighter, etc.) — SEP-53

Flash signs `sha256("Stellar Signed Message:\n" || domain || body)` with ed25519 — **SEP-53**.
`Keypair.signMessage` accepts those raw bytes. Browser wallets (Freighter, the kit) only accept a
UTF-8 **string**, so pass `messageHex` (hex of `domain || body`). The sequencer accepts both.

Frontend flow (no secret key exposure):
```ts
const { messageHex, tx } = await flash.signingMessage({
  type: 'transfer', from, to, token, amount, nonce: await flash.getNonce(from, token),
});
const signature = await wallet.signMessage(messageHex, { address: from });
await flash.submitSigned({ ...tx, signature });
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

The public app does **not** call Soroban from the browser. Users send classic XLM to
`health.network.onramp.address`. The sequencer locks it and credits FXLM. Withdrawals are
auto-claimed (`proof.claimed`).

Direct contract helpers remain for watchtowers and scripts:

```ts
import { rpc } from '@stellar/stellar-sdk';
const server = new rpc.Server('https://soroban-testnet.stellar.org');

const dep = await flash.buildDepositTx({ server, from: kp.publicKey(), token: XLM_SAC, amount: 100_0000000n });
dep.sign(kp); await server.sendTransaction(dep);

const w = await flash.withdraw({ token: XLM_SAC, amount: 10_0000000n });
await flash.waitForL1(w.id, 'finalized');
const proof = await flash.getWithdrawalProof(w.id);
if (!proof.claimed) {
  const claim = await flash.buildWithdrawClaimTx({ server, source: kp.publicKey(), proof });
  claim.sign(kp); await server.sendTransaction(claim);
}
```

## 6. npm publish (planned)

The protocol already runs in the browser (`@noble/hashes`, no `node:crypto` / `Buffer`). Split publish of `stellar-flash-sdk` is Phase 2. Until then, clone this repository and import from `sdk/src`.
