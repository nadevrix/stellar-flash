import { Bolt, Logo } from '../components/Logo.tsx';
import { LivePanel, StatusPill, useHealth } from '../components/LiveStatus.tsx';
import { ObjectShot } from '../components/ObjectShot.tsx';
import { SEQUENCER_URL } from '../lib/api.ts';

const GITHUB = 'https://github.com/nadevrix/stellar-flash';
const CONTRACT = 'CBRJ3ILZPY4AUNC5I6SC5FTRA2CJIZJPY5337FO2QO5BQ7HSB2Z7IBB4';
const EXPERT = `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`;
const WITHDRAW_TX = 'b7a3e6ce536ac97c79d06ad2dbf99b5d0870c029f41a796ba4080a057b4e9e90';

/** Botón principal: píldora oscura con flecha en círculo dorado (gesto de la web de Stellar). */
function CtaPill({ href, children, external = false, className = '' }: { href: string; children: React.ReactNode; external?: boolean; className?: string }) {
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
       className={`group inline-flex shrink-0 items-center gap-2 rounded-full bg-ink py-2 pl-4 pr-2 text-sm font-medium text-white transition hover:bg-ink/90 sm:gap-3 sm:pl-5 ${className}`}>
      {children}
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold text-ink transition group-hover:rotate-45 sm:h-9 sm:w-9">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </span>
    </a>
  );
}

const NAV_ANCHORS = [
  ['#problem', 'The problem'],
  ['#how', 'How it works'],
  ['#live', 'Live'],
  ['#app', 'App'],
] as const;

function Nav() {
  const { health } = useHealth(8000);
  return (
    <header className="sticky top-0 z-50 border-b border-ink/8 bg-white/90 backdrop-blur-md">
      <nav className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-x-4 px-4 py-3 sm:px-6 sm:py-3.5">
        <a href="#top" className="shrink-0"><Logo large /></a>

        <div className="hidden items-center justify-center gap-x-7 text-sm text-ink/65 md:flex">
          {NAV_ANCHORS.map(([href, label]) => (
            <a key={href} href={href} className="whitespace-nowrap transition hover:text-ink">{label}</a>
          ))}
          <a href="/developers" className="whitespace-nowrap transition hover:text-ink">Developers</a>
        </div>

        {/* Acciones separadas del nav — nunca pegadas al último link */}
        <div className="col-start-3 flex items-center gap-3 border-l border-ink/10 pl-4 sm:gap-4 sm:pl-5">
          <StatusPill health={health} compact />
          <a href="/bridge"
             className="hidden whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink/90 lg:inline-flex">
            Open app
          </a>
          <CtaPill href={GITHUB} external>GitHub</CtaPill>
        </div>
      </nav>

      <div className="flex gap-2 overflow-x-auto border-t border-ink/6 px-4 py-2 md:hidden">
        {NAV_ANCHORS.map(([href, label]) => (
          <a key={href} href={href} className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-ink/60">{label}</a>
        ))}
        <a href="/developers" className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-ink/60">Developers</a>
        <a href="/bridge" className="shrink-0 rounded-full bg-lab-purple/10 px-3 py-1 text-xs font-medium text-lab-purple">Open app</a>
      </div>
    </header>
  );
}

function Hero() {
  const { health } = useHealth();
  return (
    <section id="top" className="relative overflow-hidden bg-paper">
      <div className="halftone halftone-fade absolute inset-0 opacity-70" />
      <div className="relative mx-auto max-w-4xl px-6 py-28 text-center sm:py-36">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-ink/70 backdrop-blur">
          <Bolt className="h-3 w-3 text-ink" /> Payment rollup on Stellar
        </span>
        <h1 className="mt-8 font-display text-5xl font-semibold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
          Payments that confirm before you can blink
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-ink/65">
          Same <code className="font-mono text-ink">G…</code> keys, same assets, same security — funds stay
          in a Soroban contract and leave only with a Merkle proof. What changes is the wait.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <CtaPill href="/bridge">Try on testnet</CtaPill>
          <CtaPill href="/developers">Start building</CtaPill>
          <a href="#live" className="inline-flex items-center rounded-full border border-ink/15 px-6 py-3 font-medium transition hover:border-ink/40 hover:bg-white">
            See it live
          </a>
        </div>
        {health && (
          <p className="rise mt-10 font-mono text-sm text-ink/45">
            Stellar ledger #{health.l1.latestLedger.toLocaleString('en-US')} · {health.l1.ledgerAgeSec}s ago ·
            sequencer {health.l1.status === 'HEALTHY' ? 'settling' : 'holding batches'}
          </p>
        )}
      </div>
    </section>
  );
}

/** Franja de cifras: el equivalente honesto a su banda de logos de partners. */
function Numbers() {
  const items = [
    ['6 ms', 'payment confirmation', 'measured by the sequencer, not estimated'],
    ['~2 min', 'withdrawal to Stellar', 'Arbitrum makes you wait seven days'],
    ['1:1', 'backed in the vault', 'every FXLM is an XLM in the contract'],
    ['0', 'new keys to manage', 'your Stellar address is your Flash address'],
  ];
  return (
    <section className="border-y border-ink/10 bg-white">
      <div className="mx-auto grid max-w-6xl gap-px bg-ink/10 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([v, l, s]) => (
          <div key={l} className="bg-white py-10 sm:px-6">
            <div className="font-display text-4xl font-semibold text-ink">{v}</div>
            <div className="mt-2 font-medium text-ink/75">{l}</div>
            <div className="mt-1 text-sm leading-relaxed text-ink/45">{s}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section id="problem" className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="grid items-center gap-16 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-warm">The problem</p>
            <h2 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              People send $1 first, just to see if it arrives
            </h2>
            <div className="mt-8 max-w-xl space-y-5 text-lg leading-relaxed text-ink/65">
              <p>
                It is the quiet tax on every crypto payment product. Before moving real money, users
                send a tiny test amount and wait — because they have seen a payment sit
                on <em>processing…</em> before, and nobody could tell them where it went.
              </p>
              <p>Two transactions instead of one. Two waits. And a business that looks unsure of its own product.</p>
              <p className="text-ink">
                The ledger is not the problem. Stellar closes blocks every five seconds and does it well.
                The problem is that five seconds is an eternity in a checkout, and that everything between
                your app and the ledger — RPC endpoints, indexers, propagation — can have a bad afternoon
                while the network itself is perfectly fine.
              </p>
            </div>
          </div>
          <ObjectShot name="ticket" alt="A paper queue ticket: the waiting we remove" className="mx-auto" size="h-72 w-72" />
        </div>

        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          {[
            ['Payments stuck on “processing”', 'The transaction is submitted, the receipt is not there yet. The user reloads. Support gets a ticket.'],
            ['Demos that look broken', 'The network is fine; a public RPC is not. The audience only sees a spinner.'],
            ['Bulk payouts that go missing', 'Hundreds of payments from one account, sequence collisions, silent retries — and someone waits a week.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-ink/10 bg-paper p-7">
              <h3 className="font-display text-lg font-semibold">{t}</h3>
              <p className="mt-3 leading-relaxed text-ink/60">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    ['Deposit once', 'Send XLM or USDC to the flash-bridge contract. You get FXLM or FUSDC 1:1, on the very same G… address. This is the only step that waits for a ledger.'],
    ['Pay instantly', 'Payments are signed by the user with SEP-53, so existing wallets work unchanged, and confirmed in milliseconds. They never touch the L1.'],
    ['Settle in batches', 'Flash publishes batches on Stellar with the full transaction data on-chain. When the network is degraded it waits and keeps confirming; when it recovers, the backlog goes out in order.'],
    ['Withdraw whenever', 'Burn on Flash, prove with a Merkle branch, get paid by the contract. If we disappeared tomorrow the escape hatch still works — and no admin can pause it.'],
  ];
  return (
    <section id="how" className="bg-sand">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="grid items-center gap-16 lg:grid-cols-[auto_1fr]">
          <ObjectShot name="telegraph" alt="A telegraph key: instant transmission across distance" className="order-2 mx-auto lg:order-1" size="h-72 w-72" />
          <div className="order-1 lg:order-2">
            <p className="font-mono text-sm uppercase tracking-widest text-warm">How it works</p>
            <h2 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              A rollup, not a wallet with a database behind it
            </h2>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink/65">
              Arbitrum made Ethereum fast by moving execution off-chain and keeping custody and proof
              on-chain. Flash does the same for Stellar payments.
            </p>
          </div>
        </div>
        <ol className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-ink/12 bg-ink/12 sm:grid-cols-2">
          {steps.map(([t, d], i) => (
            <li key={t} className="bg-sand p-8">
              <span className="font-mono text-sm text-ink/40">0{i + 1}</span>
              <h3 className="mt-3 font-display text-xl font-semibold">{t}</h3>
              <p className="mt-3 leading-relaxed text-ink/65">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function TryApp() {
  const apps = [
    ['Bridge', '/bridge', 'Deposit testnet XLM, pay anyone instantly, withdraw back to Stellar. Connect Freighter on testnet.'],
    ['Account', '/account', 'Your dashboard: Flash balances, payment history, links to claim withdrawals. Same G… address, no signup.'],
    ['Explorer', '/explorer', 'Live feed of every payment, batch settlement on L1, Stellar network health probes.'],
    ['Developers', '/developers', 'SDK install, API reference, and examples/bounty-pay.ts for app integrations.'],
  ] as const;
  return (
    <section id="app" className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <p className="font-mono text-sm uppercase tracking-widest text-warm">Use it now</p>
        <h2 className="mt-5 max-w-2xl font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
          Everything is in the app — nothing to imagine
        </h2>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink/65">
          Start at <a href="/bridge" className="font-medium text-ink underline decoration-ink/20">Bridge</a>, then
          check <a href="/account" className="font-medium text-ink underline decoration-ink/20">Account</a> for your balances.
          Integrators go to <a href="/developers" className="font-medium text-ink underline decoration-ink/20">Developers</a>.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {apps.map(([title, href, desc]) => (
            <a key={href} href={href}
               className="group rounded-2xl border border-ink/12 p-7 transition hover:border-ink/30 hover:bg-paper">
              <h3 className="font-display text-xl font-semibold group-hover:text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/60">{desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-ink/45 group-hover:text-ink">Open →</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Live() {
  return (
    <section id="live" className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-16">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-gold">Live</p>
            <h2 className="mt-5 max-w-2xl font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              Running on Stellar testnet right now
            </h2>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/60">
              The numbers below are read from the sequencer as you look at them, and the contract is
              on-chain where anyone can inspect it.
            </p>
          </div>
          <ObjectShot
            name="stopwatch"
            alt="A stopwatch frozen just past zero"
            size="h-56 w-56 sm:h-64 sm:w-64 lg:h-72 lg:w-72"
            className="mx-auto lg:mx-0 lg:justify-self-end"
          />
        </div>
        <div className="mt-14"><LivePanel /></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <a href={EXPERT} target="_blank" rel="noreferrer"
             className="group rounded-xl border border-white/12 p-5 transition hover:border-gold/50 hover:bg-white/[0.03]">
            <div className="text-sm text-white/45">Bridge contract</div>
            <div className="mt-1 break-all font-mono text-sm text-white group-hover:text-gold">{CONTRACT}</div>
          </a>
          <a href={`https://stellar.expert/explorer/testnet/tx/${WITHDRAW_TX}`} target="_blank" rel="noreferrer"
             className="group rounded-xl border border-white/12 p-5 transition hover:border-gold/50 hover:bg-white/[0.03]">
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
    <section id="developers" className="bg-ink text-white">
      <div className="mx-auto max-w-6xl border-t border-white/10 px-6 py-28">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-gold">Developers</p>
            <h2 className="mt-5 font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              Three lines, and your payments are instant
            </h2>
            <p className="mt-7 text-lg leading-relaxed text-white/60">
              The SDK speaks the language you already use: Stellar keypairs, asset contract ids, stroops.
              Payments are signed with SEP-53, so wallets that support{' '}
              <code className="font-mono text-white">signMessage</code> work with no changes.
            </p>
            <ul className="mt-9 space-y-3.5 text-white/60">
              {[
                'Receipts carry the measured confirmation latency.',
                'Two levels of finality, always visible: confirmed on Flash, settled on Stellar.',
                'Withdrawal proofs are Merkle branches your users can verify themselves.',
                'Open source, Apache-2.0 and MIT.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Bolt className="mt-1 h-3.5 w-3.5 shrink-0 text-gold" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-3">
              <CtaPill href="/developers">Read the docs</CtaPill>
              <a href={GITHUB} target="_blank" rel="noreferrer"
                 className="inline-flex items-center rounded-full border border-white/20 px-6 py-3 font-medium transition hover:border-white/40 hover:bg-white/5">
                Source on GitHub
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0A0A0A]">
            <div className="flex items-center gap-2 border-b border-white/8 px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-2 font-mono text-xs text-white/35">pay.ts</span>
            </div>
            <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed">
<code>{`import { FlashClient, Keypair } from 'stellar-flash-sdk';

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
    <footer className="bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-start justify-between gap-12">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-5 leading-relaxed text-ink/55">
              A payment rollup on Stellar. Millisecond confirmation, settlement on Stellar,
              funds in a contract you can audit.
            </p>
          </div>
          <div className="flex gap-16 text-sm">
            <div>
              <h4 className="font-display font-semibold">Project</h4>
              <ul className="mt-4 space-y-2.5 text-ink/55">
                <li><a href={GITHUB} className="transition hover:text-ink" target="_blank" rel="noreferrer">GitHub</a></li>
                <li><a href={`${GITHUB}/blob/main/docs/00-EMPIEZA-AQUI.md`} className="transition hover:text-ink" target="_blank" rel="noreferrer">Documentation</a></li>
                <li><a href={`${GITHUB}/blob/main/CONTRIBUTING.md`} className="transition hover:text-ink" target="_blank" rel="noreferrer">Contributing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-display font-semibold">Network</h4>
              <ul className="mt-4 space-y-2.5 text-ink/55">
                <li><a href={`${SEQUENCER_URL}/v1/health`} className="transition hover:text-ink" target="_blank" rel="noreferrer">Sequencer status</a></li>
                <li><a href={EXPERT} className="transition hover:text-ink" target="_blank" rel="noreferrer">Bridge contract</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-ink/12 pt-7 text-xs leading-relaxed text-ink/45">
          <p>
            Stellar Flash is an independent project. It is <strong className="text-ink/70">not affiliated with,
            sponsored or endorsed by the Stellar Development Foundation</strong>. “Stellar” is a trademark of
            the Stellar Development Foundation; this site uses the name only to describe the network Flash is
            built on, and its logo is not used here.
          </p>
          <p className="mt-3">Testnet software. Assets on testnet have no value. Apache-2.0 for the contract, MIT for the rest.</p>
        </div>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <div className="min-h-dvh font-sans antialiased">
      <Nav />
      <main>
        <Hero />
        <Numbers />
        <Problem />
        <How />
        <TryApp />
        <Live />
        <Developers />
      </main>
      <Footer />
    </div>
  );
}
