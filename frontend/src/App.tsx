import { Logo, Mark } from './components/Logo.tsx';
import { LivePanel, StatusPill, useHealth } from './components/LiveStatus.tsx';
import { SEQUENCER_URL } from './lib/api.ts';

const GITHUB = 'https://github.com/nadevrix/stellar-flash';
const CONTRACT = 'CBRJ3ILZPY4AUNC5I6SC5FTRA2CJIZJPY5337FO2QO5BQ7HSB2Z7IBB4';
const EXPERT = `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`;
const WITHDRAW_TX = 'b7a3e6ce536ac97c79d06ad2dbf99b5d0870c029f41a796ba4080a057b4e9e90';

function Nav() {
  const { health } = useHealth(8000);
  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-ink/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top"><Logo /></a>
        <div className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          <a href="#problem" className="transition hover:text-white">The problem</a>
          <a href="#how" className="transition hover:text-white">How it works</a>
          <a href="#live" className="transition hover:text-white">Live</a>
          <a href="#developers" className="transition hover:text-white">Developers</a>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block"><StatusPill health={health} /></div>
          <a href={GITHUB} target="_blank" rel="noreferrer"
             className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:bg-gold/90">
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="grid-bg relative overflow-hidden border-b border-white/8">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-gold/8 blur-[120px]" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/8 px-3 py-1 text-xs font-medium text-gold">
          <Mark className="h-3 w-3" /> Payment rollup on Stellar
        </span>
        <h1 className="mt-7 max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          Payments that confirm<br />before you can blink.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/60">
          Stellar Flash is a rollup for payments. Same <code className="font-mono text-white/80">G…</code> keys,
          same assets, same security — money stays in a Soroban contract and leaves only with a Merkle proof.
          What changes is the wait: <span className="text-white">milliseconds instead of seconds</span>,
          and nothing breaks when the network has a bad day.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="#developers" className="rounded-lg bg-gold px-6 py-3 font-semibold text-ink transition hover:bg-gold/90">
            Start building
          </a>
          <a href="#live" className="rounded-lg border border-white/15 px-6 py-3 font-semibold text-white transition hover:border-white/30 hover:bg-white/5">
            See it live
          </a>
        </div>
        <dl className="mt-16 grid max-w-3xl grid-cols-2 gap-8 sm:grid-cols-4">
          {[
            ['6 ms', 'payment confirmation'],
            ['~2 min', 'withdrawal to Stellar'],
            ['1:1', 'backed by the vault'],
            ['0', 'new keys to manage'],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="font-mono text-3xl font-medium text-gold">{v}</dt>
              <dd className="mt-1 text-sm text-white/45">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section id="problem" className="border-b border-white/8 bg-paper text-ink">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-warm">The problem</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              People send&nbsp;$1 first, just to see if it arrives.
            </h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink/70">
              <p>
                It is the quiet tax on every crypto payment product. Before moving real money,
                users send a tiny test amount and wait — because they have seen a payment sit
                on <em>processing…</em> before, and nobody could tell them where it went.
              </p>
              <p>
                Two transactions instead of one. Two waits. And a business that looks unsure
                of its own product.
              </p>
              <p className="text-ink">
                The ledger is not the problem. Stellar closes blocks every five seconds and does
                it well. The problem is that five seconds is an eternity in a checkout, and that
                everything between your app and the ledger — RPC endpoints, indexers, propagation —
                can have a bad afternoon while the network itself is perfectly fine.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {[
              ['Payments stuck on “processing”', 'The transaction is submitted, the receipt is not there yet. The user reloads. Support gets a ticket.'],
              ['Demos that look broken', 'The network is fine; a public RPC is not. The audience only sees a spinner.'],
              ['Bulk payouts that go missing', 'Hundreds of payments from one account, sequence collisions, silent retries — and someone waits a week for their money.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-ink/10 bg-white p-6">
                <h3 className="font-display font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    ['Deposit once', 'Send XLM or USDC to the flash-bridge contract on Stellar. You get FXLM or FUSDC 1:1, on the very same G… address. This is the only step that waits for a ledger.'],
    ['Pay instantly', 'Payments inside Flash are signed by the user (SEP-53, so existing wallets work) and confirmed in milliseconds. They never touch the L1, so an RPC outage cannot stall them.'],
    ['Settle in batches', 'Flash seals batches and publishes them on Stellar, with the full transaction data on-chain. When the network is degraded it waits and keeps confirming; when it recovers, the backlog goes out in order.'],
    ['Withdraw whenever', 'Burn on Flash, prove with a Merkle branch, get paid by the contract. If we disappeared tomorrow, the escape hatch still works — and no admin can pause it.'],
  ];
  return (
    <section id="how" className="border-b border-white/8">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-sm uppercase tracking-widest text-warm">How it works</p>
        <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          A rollup, not a wallet with a database behind it.
        </h2>
        <p className="mt-6 max-w-2xl text-lg text-white/55">
          Arbitrum made Ethereum fast by moving execution off-chain and keeping custody and proof on-chain.
          Flash does the same for Stellar payments.
        </p>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/12 bg-white/10 sm:grid-cols-2">
          {steps.map(([t, d], i) => (
            <li key={t} className="bg-ink p-8">
              <span className="font-mono text-sm text-gold">0{i + 1}</span>
              <h3 className="mt-3 font-display text-xl font-semibold">{t}</h3>
              <p className="mt-3 leading-relaxed text-white/55">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.03] p-6">
          <pre className="font-mono text-xs leading-relaxed text-white/60 sm:text-sm">
{`  wallets ──signed payment (SEP-53)──▶  Flash sequencer  ──── confirms in ~6 ms
                                              │
                                              │ commit_batch  (batch data on L1)
                                              ▼
                          Stellar · flash-bridge contract  ── vault · roots · withdraw · escape`}
          </pre>
        </div>
      </div>
    </section>
  );
}

function Live() {
  return (
    <section id="live" className="border-b border-white/8 bg-white/[0.02]">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-sm uppercase tracking-widest text-warm">Live</p>
        <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Running on Stellar testnet right now.
        </h2>
        <p className="mt-6 max-w-2xl text-lg text-white/55">
          The numbers below are read from the sequencer as you look at them, and the contract is
          on-chain where anyone can inspect it.
        </p>
        <div className="mt-12"><LivePanel /></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <a href={EXPERT} target="_blank" rel="noreferrer"
             className="group rounded-xl border border-white/12 p-5 transition hover:border-gold/40 hover:bg-white/[0.03]">
            <div className="text-sm text-white/45">Bridge contract</div>
            <div className="mt-1 break-all font-mono text-sm text-white group-hover:text-gold">{CONTRACT}</div>
          </a>
          <a href={`https://stellar.expert/explorer/testnet/tx/${WITHDRAW_TX}`} target="_blank" rel="noreferrer"
             className="group rounded-xl border border-white/12 p-5 transition hover:border-gold/40 hover:bg-white/[0.03]">
            <div className="text-sm text-white/45">A real withdrawal, proved and paid on Stellar</div>
            <div className="mt-1 break-all font-mono text-sm text-white group-hover:text-gold">{WITHDRAW_TX}</div>
          </a>
        </div>
      </div>
    </section>
  );
}

function Developers() {
  return (
    <section id="developers" className="border-b border-white/8">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-warm">Developers</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Three lines, and your payments are instant.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-white/55">
              The SDK speaks the same language you already use: Stellar keypairs, asset contract
              ids, stroops. Payments are signed with SEP-53, so wallets that support{' '}
              <code className="font-mono text-white/80">signMessage</code> work with no changes.
            </p>
            <ul className="mt-8 space-y-3 text-white/55">
              {[
                'Receipts carry the measured confirmation latency.',
                'Two levels of finality, always visible: confirmed on Flash, settled on Stellar.',
                'Withdrawal proofs are Merkle branches your users can verify themselves.',
                'Open source, Apache-2.0 and MIT.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Mark className="mt-1 h-3.5 w-3.5 shrink-0 text-gold" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href={GITHUB} target="_blank" rel="noreferrer"
                 className="rounded-lg bg-gold px-6 py-3 font-semibold text-ink transition hover:bg-gold/90">
                Read the source
              </a>
              <a href={`${SEQUENCER_URL}/v1/health`} target="_blank" rel="noreferrer"
                 className="rounded-lg border border-white/15 px-6 py-3 font-semibold transition hover:border-white/30 hover:bg-white/5">
                Try the API
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0B0B0B]">
            <div className="flex items-center gap-2 border-b border-white/8 px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-2 font-mono text-xs text-white/35">pay.ts</span>
            </div>
            <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed">
<code>{`import { FlashClient, Keypair } from '@stellar-flash/sdk';

const flash = new FlashClient({
  baseUrl: '`}<span className="text-teal">{SEQUENCER_URL.replace('https://', '')}</span>{`',
  keypair: Keypair.fromSecret(process.env.SECRET),
});

`}<span className="text-white/35">{'// Pays 2.5 XLM inside Flash. No ledger to wait for.'}</span>{`
const receipt = await flash.`}<span className="text-gold">transfer</span>{`({
  to:     '`}<span className="text-teal">GBXRLWDX…IZ7E</span>{`',
  token:  XLM_SAC,
  amount: 25_000_000n,
});

receipt.latencyUs;   `}<span className="text-white/35">{'// 6_281'}</span>{`
receipt.finality;    `}<span className="text-white/35">{"// { l2: 'instant', l1: 'pending' }"}</span>
</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-white/45">
              A payment rollup on Stellar. Millisecond confirmation, settlement on Stellar,
              funds in a contract you can audit.
            </p>
          </div>
          <div className="flex gap-14 text-sm">
            <div>
              <h4 className="font-display font-semibold text-white">Project</h4>
              <ul className="mt-4 space-y-2.5 text-white/45">
                <li><a href={GITHUB} className="transition hover:text-gold" target="_blank" rel="noreferrer">GitHub</a></li>
                <li><a href={`${GITHUB}/blob/main/docs/00-EMPIEZA-AQUI.md`} className="transition hover:text-gold" target="_blank" rel="noreferrer">Documentation</a></li>
                <li><a href={`${GITHUB}/blob/main/CONTRIBUTING.md`} className="transition hover:text-gold" target="_blank" rel="noreferrer">Contributing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-display font-semibold text-white">Network</h4>
              <ul className="mt-4 space-y-2.5 text-white/45">
                <li><a href={`${SEQUENCER_URL}/v1/health`} className="transition hover:text-gold" target="_blank" rel="noreferrer">Sequencer status</a></li>
                <li><a href={EXPERT} className="transition hover:text-gold" target="_blank" rel="noreferrer">Bridge contract</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-14 border-t border-white/10 pt-7 text-xs leading-relaxed text-white/35">
          <p>
            Stellar Flash is an independent project. It is <strong className="text-white/50">not affiliated
            with, sponsored or endorsed by the Stellar Development Foundation</strong>. “Stellar” is a
            trademark of the Stellar Development Foundation; this site uses the name only to describe
            the network Flash is built on, and its logo is not used here.
          </p>
          <p className="mt-3">
            Testnet software. Assets on testnet have no value. Apache-2.0 for the contract, MIT for the rest.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  return (
    <div className="min-h-dvh font-sans antialiased">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <How />
        <Live />
        <Developers />
      </main>
      <Footer />
    </div>
  );
}
