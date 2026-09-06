import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, PageHeader } from '../components/ui/Lab.tsx';
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
    <div className="mx-auto max-w-3xl">
      <Link to="/explorer" className="text-sm text-muted hover:text-lab-purple">← Transactions</Link>
      <PageHeader
        eyebrow="Account"
        title={short(address, 8)}
        description={<a href={EXPERT.account(address)} target="_blank" rel="noreferrer" className="font-mono text-sm text-lab-purple underline break-all">{address}</a>}
      />

      <Card className="p-6">
        <div className="text-sm text-muted">Flash balances</div>
        {!account || account.balances.length === 0 ? (
          <p className="mt-2 text-muted">No Flash balance.</p>
        ) : (
          <ul className="mt-3 space-y-2">{account.balances.map((b) => (
            <li key={b.token} className="font-mono text-xl">{fmtStroops(b.balance)} F{symbols[b.token] ?? 'XLM'}</li>
          ))}</ul>
        )}
      </Card>

      {account && account.transactions.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Activity" />
          <ul className="divide-y divide-border">
            {account.transactions.map((t) => (
              <li key={t.id}>
                <Link to={`/tx/${t.id}`} className="flex justify-between px-5 py-3 text-sm hover:bg-surface">
                  <span className="capitalize">{t.type}</span>
                  <span className="font-mono">{fmtStroops(t.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
