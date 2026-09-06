import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../components/AppNav.tsx';
import { fetchAccount, fetchTokens, SEQUENCER_URL } from '../lib/api.ts';
import { EXPERT, fmtStroops } from '../lib/format.ts';
import { connectWallet, disconnectWallet, restoreWallet } from '../lib/wallet.ts';

const TYPE_LABEL = { deposit: 'Deposit', transfer: 'Payment', withdraw: 'Withdrawal' } as const;

export function Account() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [account, setAccount] = useState<Awaited<ReturnType<typeof fetchAccount>> | null>(null);
  const [symbols, setSymbols] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void restoreWallet().then((a) => a && setWallet(a)); }, []);
  useEffect(() => { void fetchTokens().then((r) => setSymbols(Object.fromEntries(r.tokens.map((t) => [t.id, t.symbol])))); }, []);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      setAccount(await fetchAccount(wallet));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!wallet) {
    return (
      <div className="min-h-dvh bg-paper font-sans text-ink">
        <AppNav badge="account" />
        <main className="mx-auto max-w-lg px-6 py-24 text-center">
          <h1 className="font-display text-4xl font-semibold">Your Flash account</h1>
          <p className="mt-4 text-ink/60">Connect the same Stellar wallet you use everywhere. Your <code className="font-mono">G…</code> address is your Flash account — no signup.</p>
          <button
            onClick={() => void connectWallet().then(setWallet)}
            className="mt-8 rounded-full bg-ink px-8 py-3.5 font-medium text-white transition hover:bg-ink/90"
          >
            Connect wallet
          </button>
          <p className="mt-8 text-sm text-ink/45">Or look up any address: <a href="/explorer" className="underline">Explorer</a></p>
        </main>
      </div>
    );
  }

  const primary = account?.balances[0];

  return (
    <div className="min-h-dvh bg-paper font-sans text-ink">
      <AppNav badge="account" />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold">Account</h1>
            <p className="mt-2 font-mono text-sm text-ink/50">
              <a href={EXPERT.account(wallet)} target="_blank" rel="noreferrer" className="hover:text-ink">{wallet}</a>
            </p>
          </div>
          <div className="flex gap-2">
            <a href="/bridge" className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-ink">Deposit / Pay</a>
            <button onClick={() => void disconnectWallet().then(() => setWallet(null))}
              className="rounded-full border border-ink/15 px-4 py-2.5 text-sm">Disconnect</button>
          </div>
        </div>

        {error && <p className="mt-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {(account?.balances.length ? account.balances : [{ token: '—', balance: '0', nonce: '0' }]).map((b) => (
            <div key={b.token} className="rounded-2xl border border-ink/12 bg-white p-6">
              <div className="text-sm text-ink/50">On Flash</div>
              <div className="mt-1 font-mono text-3xl font-medium">{fmtStroops(b.balance)}</div>
              <div className="mt-1 text-sm text-ink/45">F{symbols[b.token] ?? 'XLM'} · nonce {b.nonce}</div>
            </div>
          ))}
          <div className="rounded-2xl border border-ink/12 bg-white p-6">
            <div className="text-sm text-ink/50">Quick links</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href="/bridge" className="text-ink underline decoration-ink/20">Bridge → deposit, pay, withdraw</a></li>
              <li><a href="/developers" className="text-ink underline decoration-ink/20">Developers → SDK &amp; API</a></li>
              <li><a href={`${SEQUENCER_URL}/v1/accounts/${wallet}`} target="_blank" rel="noreferrer" className="font-mono text-ink/60 underline">Raw JSON</a></li>
            </ul>
          </div>
        </div>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Activity</h2>
          {!account ? (
            <p className="mt-4 text-ink/45">Loading…</p>
          ) : account.transactions.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-ink/15 bg-white px-6 py-12 text-center">
              <p className="text-ink/60">No Flash activity yet.</p>
              <a href="/bridge" className="mt-4 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-medium text-white">Deposit testnet XLM</a>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-ink/8 overflow-hidden rounded-2xl border border-ink/12 bg-white">
              {account.transactions.map((t) => (
                <li key={t.id}>
                  <a href={`/tx/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-4 transition hover:bg-paper">
                    <div>
                      <span className="text-sm font-medium">{TYPE_LABEL[t.type] ?? t.type}</span>
                      <span className="ml-2 font-mono text-xs text-ink/40">{new Date(t.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-right font-mono text-sm">
                      {fmtStroops(t.amount)} {symbols[t.token] ?? 'XLM'}
                      {t.batchIndex !== null && <span className="ml-2 text-xs text-ink/40">batch #{t.batchIndex}</span>}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!primary && account && (
          <p className="mt-6 text-center text-sm text-ink/45">
            Balances show <strong>0</strong> until your first deposit is credited (~5–10 s after the Stellar tx confirms).
          </p>
        )}
      </main>
    </div>
  );
}
