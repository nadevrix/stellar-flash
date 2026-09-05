import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo.tsx';
import { StatusPill, useHealth } from '../components/LiveStatus.tsx';
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
    <section id={id} className="scroll-mt-24 border-t border-ink/10 pt-12">
      <h2 className="font-display text-3xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-6 space-y-5 text-[17px] leading-relaxed text-ink/70">{children}</div>
    </section>
  );
}

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/v1/health', 'Estado de la L2 y de Stellar: semáforo, último ledger, fee p90, decisión de liquidación.'],
  ['GET', '/v1/stats?window=60', 'txs/s, latencia p50/p99, lotes publicados y tiempo medio de sellado a L1.'],
  ['GET', '/v1/transactions?limit=25', 'Últimos pagos de toda la L2.'],
  ['GET', '/v1/transactions/:id', 'Un pago, con su lote y sus dos niveles de finalidad.'],
  ['POST', '/v1/transactions', 'Enviar un pago firmado (SEP-53).'],
  ['GET', '/v1/accounts/:G', 'Saldos por token, nonce e historial.'],
  ['GET', '/v1/accounts/:G/nonce?token=', 'Siguiente nonce para firmar.'],
  ['GET', '/v1/batches?limit=', 'Lotes, con estado y hash de la tx en Stellar.'],
  ['GET', '/v1/batches/:i?data=1', 'Un lote con sus datos: permite re-ejecutarlo y verificar la raíz.'],
  ['GET', '/v1/withdrawals/:id/proof', 'Prueba Merkle para reclamar un retiro en L1.'],
  ['GET', '/v1/l1/history', 'Historial de sondas a Stellar.'],
];

export function Developers() {
  const { health } = useHealth(8000);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => { setOk(health !== null); }, [health]);

  return (
    <div className="min-h-dvh bg-white font-sans text-ink">
      <header className="sticky top-0 z-40 border-b border-ink/8 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-5">
            <a href="/"><Logo /></a>
            <span className="hidden font-mono text-xs text-ink/35 sm:inline">developers</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block"><StatusPill health={health} /></div>
            <a href="/explorer" className="rounded-full border border-ink/15 px-4 py-2 text-sm font-medium transition hover:border-ink/40">Explorer</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-mono text-sm uppercase tracking-widest text-warm">Developers</p>
        <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.1] tracking-tight">
          Integrate Flash in an afternoon
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink/65">
          Flash speaks the language you already use: Stellar keypairs, asset contract ids, stroops.
          There are no new keys, no new addresses and no new asset to explain to your users — an
          account on Flash <em>is</em> a Stellar account.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm ${ok ? 'border-teal/40 text-teal' : 'border-ink/15 text-ink/45'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-teal pulse-dot' : 'bg-warm'}`} />
            {ok ? 'Testnet sequencer is up' : 'checking the sequencer…'}
          </span>
          <a href={`${SEQUENCER_URL}/v1/health`} target="_blank" rel="noreferrer" className="font-mono text-sm text-ink/50 underline decoration-ink/20 underline-offset-4 hover:text-ink">
            {SEQUENCER_URL.replace('https://', '')}
          </a>
        </div>

        <div className="mt-16 space-y-14">
          <Section id="install" title="Install">
            <p>The SDK is a thin client over the HTTP API. <code className="font-mono text-ink">@stellar/stellar-sdk</code> is a peer dependency, so your project keeps a single copy of it.</p>
            <Code lang="bash">{`npm install ${PKG} @stellar/stellar-sdk`}</Code>
            <p className="text-ink/55">Node ≥ 20. The package is server-side: the protocol uses <code className="font-mono">node:crypto</code> for hashing.</p>
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
const { message, tx } = await flash.signingMessage({
  type: 'transfer', from: userAddress, to, token, amount: 25_000_000n,
});

// \`message\` are the exact bytes to sign. Any SEP-53 wallet does this.
const signature = await wallet.signMessage(message);   // Freighter, xBull, Lobstr…

const receipt = await flash.submitSigned({
  ...tx,
  signature: Buffer.from(signature).toString('hex'),
});`}</Code>
          </Section>

          <Section id="in-out" title="Deposits and withdrawals">
            <p>
              Entering and leaving are Stellar transactions — they are the only steps that wait for a
              ledger. In practice a platform deposits its float once and its users never touch the L1.
            </p>
            <Code>{`// In: funds land in the flash-bridge contract, credited when the ledger closes.
const depositTx = await flash.buildDepositTx({ server, from, token, amount: 100_000_000n });

// Out: burn on Flash, then claim on Stellar with the Merkle proof.
const { id } = await flash.withdraw({ token, amount: 20_000_000n, l1Recipient: from });
const proof  = await flash.getWithdrawalProof(id);
if (proof.claimable) {
  const claim = await flash.buildWithdrawClaimTx({ server, source: from, proof });
}`}</Code>
            <p>
              The contract also exposes <code className="font-mono text-ink">escape</code>, which the admin
              <strong className="text-ink"> cannot pause</strong>. If the sequencer disappeared, users still
              get their funds out — that property is what makes this infrastructure and not a custodian.
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
                    ['BAD_NONCE', 'Otro pago tuyo se adelantó. Relee el nonce y reintenta una vez.'],
                    ['INSUFFICIENT_BALANCE', 'Saldo insuficiente en Flash para ese token.'],
                    ['INVALID_SIGNATURE', 'La wallet firmó un mensaje distinto al que se envió.'],
                    ['TOKEN_NOT_ALLOWED', 'Ese contrato de activo no está habilitado en este secuenciador.'],
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

        <div className="mt-16 rounded-2xl border border-ink/12 bg-paper p-8">
          <h3 className="font-display text-xl font-semibold">Testnet, and honest about it</h3>
          <p className="mt-3 leading-relaxed text-ink/65">
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
      </main>
    </div>
  );
}
