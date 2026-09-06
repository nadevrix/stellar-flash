import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, BtnPrimary, Card, CardHeader, PageHeader } from '../components/ui/Lab.tsx';
import { useWallet } from '../context/WalletContext.tsx';
import { fetchAccount, fetchTokens, SEQUENCER_URL } from '../lib/api.ts';
import { EXPERT, fmtStroops } from '../lib/format.ts';

const TYPE_LABEL = { deposit: 'Deposit', transfer: 'Payment', withdraw: 'Withdrawal' } as const;

export function Account() {
  const { address, connect, connecting } = useWallet();
  const [account, setAccount] = useState<Awaited<ReturnType<typeof fetchAccount>> | null>(null);
  const [symbols, setSymbols] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void fetchTokens().then((r) => setSymbols(Object.fromEntries(r.tokens.map((t) => [t.id, t.symbol])))); }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setAccount(await fetchAccount(address));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes('502') || msg.includes('Failed to fetch')
        ? 'El secuenciador no responde (502). Reinicia stellar-flash-sequencer en Render.'
        : msg);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!address) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader eyebrow="Account" title="Your Flash balances" description="Connect a wallet to see FXLM balances and payment history. Your G… address is your Flash account." />
        <Card className="p-8 text-center">
          <BtnPrimary onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</BtnPrimary>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Account"
        title="Balances & activity"
        description={
          <>
            <a href={EXPERT.account(address)} target="_blank" rel="noreferrer" className="font-mono text-sm text-lab-purple underline">{address}</a>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(account?.balances.length ? account.balances : [{ token: '—', balance: '0', nonce: '0' }]).map((b) => (
          <Card key={b.token} className="p-6">
            <div className="text-sm text-muted">On Flash</div>
            <div className="mt-1 font-mono text-3xl font-medium">{fmtStroops(b.balance)}</div>
            <div className="mt-1 text-sm text-muted">F{symbols[b.token] ?? 'XLM'} · nonce {b.nonce}</div>
          </Card>
        ))}
        <Card className="p-6">
          <div className="text-sm font-medium text-ink">Quick actions</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/bridge" className="text-lab-purple underline">Bridge → deposit, pay, withdraw</Link></li>
            <li><Link to="/developers" className="text-lab-purple underline">API explorer → SDK</Link></li>
            <li><a href={`${SEQUENCER_URL}/v1/accounts/${address}`} target="_blank" rel="noreferrer" className="font-mono text-muted underline">Raw JSON</a></li>
          </ul>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader title="Activity" hint="Recent Flash transactions" />
        {!account ? (
          <p className="px-5 py-8 text-sm text-muted">Loading…</p>
        ) : account.transactions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-muted">No Flash activity yet.</p>
            <Link to="/bridge" className="mt-4 inline-block"><BtnPrimary>Deposit testnet XLM</BtnPrimary></Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {account.transactions.map((t) => (
              <li key={t.id}>
                <Link to={`/tx/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-4 transition hover:bg-surface">
                  <div>
                    <span className="text-sm font-medium">{TYPE_LABEL[t.type] ?? t.type}</span>
                    <span className="ml-2 font-mono text-xs text-muted">{new Date(t.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-right font-mono text-sm">
                    {fmtStroops(t.amount)} {symbols[t.token] ?? 'XLM'}
                    {t.batchIndex !== null && <span className="ml-2 text-xs text-muted">batch #{t.batchIndex}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
