import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav.tsx';
import { fetchTx, SEQUENCER_URL } from '../lib/api.ts';
import { EXPERT, ms } from '../lib/format.ts';

export function TxDetail() {
  const { id } = useParams();
  const [tx, setTx] = useState<Awaited<ReturnType<typeof fetchTx>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void fetchTx(id).then(setTx).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => void fetchTx(id).then(setTx).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [id]);

  return (
    <div className="min-h-dvh bg-paper font-sans text-ink">
      <AppNav badge="transaction" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link to="/explorer" className="text-sm text-ink/50 hover:text-ink">← Explorer</Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">Transaction</h1>
        {error && <p className="mt-4 text-red-700">{error}</p>}
        {!tx && !error && <p className="mt-4 text-ink/45">Loading…</p>}
        {tx && (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl border border-ink/12 bg-white p-6 font-mono text-sm break-all">
              <div className="text-ink/45">id</div>
              <div>{tx.id}</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label="Type" value={tx.type} />
              <Stat label="Seq" value={String(tx.seq)} />
              <Stat label="L2 finality" value={tx.finality.l2} />
              <Stat label="L1 finality" value={tx.finality.l1} />
              <Stat label="Latency" value={ms(tx.latencyUs)} />
              <Stat label="When" value={new Date(tx.createdAt).toLocaleString()} />
            </div>
            {tx.batch && (
              <div className="rounded-2xl border border-ink/12 bg-white p-6">
                <div className="text-sm text-ink/50">Batch</div>
                <Link to={`/batches/${tx.batch.index}`} className="font-mono text-lg underline">#{tx.batch.index}</Link>
                <span className="ml-3 rounded-full border border-ink/15 px-2 py-0.5 text-xs">{tx.batch.status}</span>
                {tx.batch.l1TxHash && (
                  <a href={EXPERT.tx(tx.batch.l1TxHash)} target="_blank" rel="noreferrer"
                    className="mt-2 block font-mono text-xs text-ink/50 underline">{tx.batch.l1TxHash}</a>
                )}
              </div>
            )}
            {tx.type === 'withdraw' && (
              <a href="/bridge" className="inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-medium text-white">
                Claim in Bridge →
              </a>
            )}
            <a href={`${SEQUENCER_URL}/v1/transactions/${tx.id}`} target="_blank" rel="noreferrer"
              className="block text-xs text-ink/40 underline">Raw JSON</a>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3">
      <div className="text-xs text-ink/45">{label}</div>
      <div className="mt-1 font-medium capitalize">{value}</div>
    </div>
  );
}
