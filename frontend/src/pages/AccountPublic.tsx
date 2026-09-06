import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav.tsx';
import { fetchAccount, fetchTokens } from '../lib/api.ts';
import { EXPERT, fmtStroops, short } from '../lib/format.ts';

export function AccountPublic() {
  const { address } = useParams();
  const [account, setAccount] = useState<Awaited<ReturnType<typeof fetchAccount>> | null>(null);
  const [symbols, setSymbols] = useState<Record<string, string>>({});

  useEffect(() => { void fetchTokens().then((r) => setSymbols(Object.fromEntries(r.tokens.map((t) => [t.id, t.symbol])))); }, []);
  useEffect(() => {
    if (!address) return;
    void fetchAccount(address).then(setAccount);
    const t = setInterval(() => void fetchAccount(address).then(setAccount).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [address]);

  if (!address) return null;

  return (
    <div className="min-h-dvh bg-paper font-sans text-ink">
      <AppNav badge="account" />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/explorer" className="text-sm text-ink/50">← Explorer</Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">{short(address, 8)}</h1>
        <a href={EXPERT.account(address)} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-xs text-ink/45 break-all hover:text-ink">{address}</a>

        <div className="mt-8 rounded-2xl border border-ink/12 bg-white p-6">
          <div className="text-sm text-ink/50">Flash balances</div>
          {!account || account.balances.length === 0 ? (
            <p className="mt-2 text-ink/45">No Flash balance.</p>
          ) : (
            <ul className="mt-3 space-y-2">{account.balances.map((b) => (
              <li key={b.token} className="font-mono text-xl">{fmtStroops(b.balance)} F{symbols[b.token] ?? 'XLM'}</li>
            ))}</ul>
          )}
        </div>

        {account && account.transactions.length > 0 && (
          <ul className="mt-6 divide-y divide-ink/8 rounded-2xl border border-ink/12 bg-white">
            {account.transactions.map((t) => (
              <li key={t.id}>
                <Link to={`/tx/${t.id}`} className="flex justify-between px-5 py-3 text-sm hover:bg-paper">
                  <span className="capitalize">{t.type}</span>
                  <span className="font-mono">{fmtStroops(t.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
