import { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui/Lab.tsx';
import { useHealth } from '../components/LiveStatus.tsx';
import { SEQUENCER_URL } from '../lib/api.ts';

const PKG = 'stellar-flash-sdk';
const GITHUB = 'https://github.com/nadevrix/stellar-flash';

function Code({ children, lang = 'ts' }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ink/12 bg-[#0C0C0C]">
      <button
        onClick={() => { void navigator.clipboard.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}
        className="absolute right-3 top-3 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/60 opacity-0 transition group-hover:opacity-100 hover:text-white"
      >
        {copied ? 'copied' : 'copy'}
      </button>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-white/85"><code>{children.trimEnd()}</code></pre>
      <span className="sr-only">{lang}</span>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-6 space-y-5 text-base leading-relaxed text-muted">{children}</div>
    </section>
  );
}

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/v1/health', 'L2 counters, Stellar health, last settlement decision, allowed tokens.'],
  ['GET', '/v1/stats?window=60', 'txs/s, latency p50/p99, lifetime stats, batches published.'],
  ['GET', '/v1/transactions?limit=25', 'Latest payments across the whole L2.'],
  ['GET', '/v1/transactions/:id', 'One payment, its batch, and both finality levels.'],
  ['POST', '/v1/transactions', 'Submit a SEP-53 signed payment.'],
  ['GET', '/v1/accounts/:G', 'Balances, nonce, and history.'],
  ['GET', '/v1/accounts/:G/nonce?token=', 'Next nonce for signing.'],
  ['GET', '/v1/batches?limit=', 'Batches with status and Stellar tx hash.'],
  ['GET', '/v1/batches/:i?data=1', 'One batch with tx data — replay it and check the root.'],
  ['GET', '/v1/tokens', 'Enabled token metadata (alias: /v1/assets).'],
  ['GET', '/v1/withdrawals/:id/proof', 'Merkle proof; `claimed` once we have paid XLM on L1.'],
  ['GET', '/v1/onramp?account=', 'Classic XLM payments we saw and locked in the vault.'],
  ['GET', '/v1/l1/history', 'Stellar RPC probe history.'],
];

export function Developers() {
  const { health } = useHealth(8000);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => { setOk(health !== null); }, [health]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="API explorer"
        title="Integrate Flash in an afternoon"
        description="Flash speaks the language you already use: Stellar keypairs, asset contract ids, stroops. An account on Flash is a Stellar account."
      />

        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-sm ${ok ? 'border-teal/40 text-teal' : 'border-border text-muted'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-teal pulse-dot' : 'bg-warm'}`} />
            {ok ? 'Testnet sequencer is up' : 'checking the sequencer…'}
          </span>
          <a href={`${SEQUENCER_URL}/v1/health`} target="_blank" rel="noreferrer" className="font-mono text-sm text-muted underline hover:text-ink">
            {SEQUENCER_URL.replace('https://', '')}
          </a>
        </div>

        <div className="mt-12 space-y-14">
          <Section id="product" title="Product map">
            <ul className="list-inside list-disc space-y-2 text-ink/70">
              <li><a href="/bridge" className="underline">Bridge</a> — on-ramp / off-ramp for wallets (deposit, pay, withdraw)</li>
              <li><a href="/account" className="underline">Account</a> — balances and history for your connected wallet</li>
              <li><a href="/explorer" className="underline">Explorer</a> — live network feed, batches, Stellar health</li>
              <li><a href={`${GITHUB}/tree/main/examples`} target="_blank" rel="noreferrer" className="underline">examples/</a> — bounty payouts script (<code className="font-mono text-sm">examples/bounty-pay.ts</code>)</li>
            </ul>
          </Section>

          <Section id="install" title="Install">
            <p>
              The SDK is <strong className="text-ink">not on npm yet</strong>. Clone the repo so you
              run the same protocol as the sequencer. The published name will be{' '}
              <code className="font-mono text-ink">{PKG}</code>.
            </p>
            <Code lang="bash">{`git clone ${GITHUB}
cd stellar-flash && npm install
# import { FlashClient } from './sdk/src/index.ts'`}</Code>
            <p className="text-ink/55">Works on the server and in the browser — the protocol has no Node-only dependencies, so your dapp can build the message the wallet signs instead of trusting a backend to hand it over.</p>
          </Section>

          <Section id="pay" title="Send a payment">
            <p>This is the whole integration. The receipt carries the latency the sequencer actually measured — not an estimate.</p>
            <Code>{`import { FlashClient, Keypair } from '${PKG}';

const flash = new FlashClient({
  baseUrl: '${SEQUENCER_URL}',
  keypair: Keypair.fromSecret(process.env.SECRET!),
});

const receipt = await flash.transfer({
  to:     'GBXRLWDXMS53IWIORBCCOYBG5JPVUBZ36RVFH3R2FZB5OEJ5ZJWFIZ7E',
  token:  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // XLM on testnet
  amount: 25_000_000n,  // stroops — 2.5 XLM
});

receipt.latencyUs;  // 6_005
receipt.finality;   // { l2: 'instant', l1: 'pending' }`}</Code>
          </Section>

          <Section id="finality" title="Show both levels of finality">
            <p>
              Never hide the second one. Showing “confirmed now, settling on Stellar” is what removes
              the $1 test payment: the user gets certainty immediately and still sees the on-chain
              proof arrive.
            </p>
            <div className="overflow-hidden rounded-xl border border-ink/12">
              <table className="w-full text-left text-sm">
                <thead className="bg-paper text-ink/60">
                  <tr><th className="px-5 py-3 font-medium">Field</th><th className="px-5 py-3 font-medium">Meaning</th><th className="px-5 py-3 font-medium">When</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  <tr><td className="px-5 py-3 font-mono">finality.l2</td><td className="px-5 py-3">Confirmed on Flash, balances moved</td><td className="px-5 py-3 text-ink/55">~6 ms</td></tr>
                  <tr><td className="px-5 py-3 font-mono">finality.l1</td><td className="px-5 py-3">Batch published on Stellar</td><td className="px-5 py-3 text-ink/55">seconds later</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="wallets" title="Sign with the user’s wallet">
            <p>
              Payments are signed with <strong className="text-ink">SEP-53</strong>, so any Stellar wallet
              that supports <code className="font-mono">signMessage</code> works with no changes. Build the
              message, have the wallet sign it, and submit.
            </p>
            <Code>{`// No keypair needed on the client.
const { messageHex, tx } = await flash.signingMessage({
  type: 'transfer', from: userAddress, to, token, amount: 25_000_000n,
});

// Freighter only accepts a UTF-8 string — pass the hex of domain||body.
const signature = await wallet.signMessage(messageHex);

const receipt = await flash.submitSigned({ ...tx, signature });`}</Code>
          </Section>

          <Section id="in-out" title="Deposits and withdrawals">
            <p>
              Users send <strong className="text-ink">ordinary XLM</strong> (Horizon) to the sequencer
              address in <code className="font-mono text-ink">GET /v1/health</code> → <code className="font-mono text-ink">network.onramp</code>.
              We invoke <code className="font-mono text-ink">deposit</code> on the vault and credit FXLM.
              Payments after that never touch Soroban RPC.
            </p>
            <Code>{`// In: a classic payment. The sequencer locks XLM and credits FXLM.
// Send native XLM to health.network.onramp.address (Horizon, not Soroban).

// Out: burn on Flash. We claim the Merkle withdrawal and pay XLM back.
const { id } = await flash.withdraw({ token, amount: 20_000_000n, l1Recipient: from });
// Poll until proof.claimed === true — no buildWithdrawClaimTx in the wallet.

// Advanced / watchtower: still possible to call the contract yourself.
const depositTx = await flash.buildDepositTx({ server, from, token, amount: 100_000_000n });
const claim = await flash.buildWithdrawClaimTx({ server, source: from, proof });`}</Code>
            <p>
              The contract also exposes <code className="font-mono text-ink">escape</code>, which the admin
              <strong className="text-ink"> cannot pause</strong>. If the sequencer disappeared, users still
              get their funds out — that property is what makes this infrastructure and not a custodian.
              The onramp has a brief window where XLM sits on the operator account before it is locked;
              once it is in the vault, the same Merkle / escape guarantees apply.
            </p>
          </Section>

          <Section id="api" title="HTTP API">
            <p>Everything the SDK does is plain JSON over HTTP, with open CORS. You can integrate without the SDK.</p>
            <div className="overflow-hidden rounded-xl border border-ink/12">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-ink/8">
                  {ENDPOINTS.map(([m, path, desc]) => (
                    <tr key={path}>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink/45">{m}</td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-[13px]">{path}</td>
                      <td className="px-5 py-3 text-ink/60">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Code lang="bash">{`curl -s ${SEQUENCER_URL}/v1/health | jq`}</Code>
          </Section>

          <Section id="verify" title="Verify us">
            <p>
              Batches are published on Stellar with their full transaction data, so anyone can replay
              them and check the state root. You do not have to trust the sequencer — and neither do
              your users.
            </p>
            <Code lang="bash">{`# every batch, with its data, its roots and its Stellar transaction
curl -s ${SEQUENCER_URL}/v1/batches/0?data=1 | jq`}</Code>
          </Section>

          <Section id="errors" title="Errors worth handling">
            <div className="overflow-hidden rounded-xl border border-ink/12">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-ink/8">
                  {[
                    ['BAD_NONCE', 'Another payment of yours landed first. Re-read the nonce and retry once.'],
                    ['INSUFFICIENT_BALANCE', 'Not enough Flash balance for that token.'],
                    ['INVALID_SIGNATURE', 'The wallet signed a different message than the one submitted.'],
                    ['TOKEN_NOT_ALLOWED', 'That asset contract is not enabled on this sequencer.'],
                    ['SELF_TRANSFER', 'You cannot pay yourself. Use another G… address.'],
                  ].map(([code, desc]) => (
                    <tr key={code}>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-[13px] text-gold">{code}</td>
                      <td className="px-5 py-3 text-ink/60">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="mt-12 rounded-xl border border-border bg-surface p-8">
          <h3 className="text-xl font-semibold">Testnet, and honest about it</h3>
          <p className="mt-3 leading-relaxed text-muted">
            Flash runs on Stellar testnet today; testnet assets have no value. Fraud proofs are
            specified but not implemented, so for now the challenge period is an emergency-stop
            window rather than a cryptographic guarantee. The roadmap and the reasoning are in the
            repository.
          </p>
          <a href={GITHUB} target="_blank" rel="noreferrer"
             className="mt-5 inline-flex items-center gap-2 font-medium underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
            Read the source
          </a>
        </div>
    </div>
  );
}
