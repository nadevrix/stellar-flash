import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav.tsx';
import { fetchBatch, SEQUENCER_URL } from '../lib/api.ts';
import { EXPERT, ago, fmtStroops } from '../lib/format.ts';

export function BatchDetail() {
  const { index } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchBatch>> | null>(null);

  useEffect(() => {
    if (!index) return;
    void fetchBatch(index).then(setData).catch(() => setData(null));
    const t = setInterval(() => void fetchBatch(index).then(setData).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [index]);

  const b = data?.batch;

  return (
    <div className="min-h-dvh bg-ink font-sans text-white">
      <AppNav variant="dark" badge={`batch #${index ?? ''}`} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/explorer" className="text-sm text-white/50 hover:text-white">← Explorer</Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">Batch #{index}</h1>
        {!b && <p className="mt-4 text-white/40">Loading…</p>}
        {b && (
          <div className="mt-8 space-y-6">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-white/12 bg-white/10 sm:grid-cols-2">
              <Cell label="Status" value={b.status} />
              <Cell label="Transactions" value={String(b.txCount)} />
              <Cell label="Data size" value={`${b.txDataBytes} B`} />
              <Cell label="Sealed" value={`${ago(b.sealedAt)} ago`} />
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/[0.02] p-5 font-mono text-xs break-all">
              <div className="text-white/40">State root</div>
              <div className="mt-1">{b.newStateRoot}</div>
            </div>
            {b.l1TxHash ? (
              <a href={EXPERT.tx(b.l1TxHash)} target="_blank" rel="noreferrer"
                className="inline-block rounded-full border border-gold/40 px-5 py-2 text-sm text-gold">
                View on stellar.expert →
              </a>
            ) : (
              <p className="text-sm text-white/45">Waiting for Stellar L1…</p>
            )}
            {data!.withdrawals.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold">Withdrawals in batch</h2>
                <ul className="mt-3 divide-y divide-white/8 rounded-xl border border-white/12">
                  {data!.withdrawals.map((w) => (
                    <li key={w.txId} className="flex justify-between px-4 py-3 font-mono text-sm">
                      <Link to={`/tx/${w.txId}`} className="text-gold underline">{w.txId.slice(0, 12)}…</Link>
                      <span>{fmtStroops(w.amount)} → {w.recipient.slice(0, 8)}…</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <a href={`${SEQUENCER_URL}/v1/batches/${index}?data=1`} target="_blank" rel="noreferrer"
              className="text-xs text-white/35 underline">Download batch data (JSON)</a>
          </div>
        )}
      </main>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-5 py-4">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-1 font-mono capitalize">{value}</div>
    </div>
  );
}
