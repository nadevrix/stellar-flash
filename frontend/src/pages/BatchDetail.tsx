import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, PageHeader, StatTile } from '../components/ui/Lab.tsx';
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
    <div className="mx-auto max-w-3xl">
      <Link to="/explorer" className="text-sm text-muted hover:text-lab-purple">← Transactions</Link>
      <PageHeader eyebrow="Batch" title={`Batch #${index ?? ''}`} />
      {!b && <p className="text-muted">Loading…</p>}
      {b && (
        <div className="space-y-6">
          <Card className="grid overflow-hidden sm:grid-cols-2">
            <StatTile label="Status" value={b.status} />
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Transactions" value={String(b.txCount)} /></div>
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Data size" value={`${b.txDataBytes} B`} /></div>
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Sealed" value={`${ago(b.sealedAt)} ago`} /></div>
          </Card>
          <Card className="p-5 font-mono text-xs break-all">
            <div className="text-muted">State root</div>
            <div className="mt-1">{b.newStateRoot}</div>
          </Card>
          {b.l1TxHash ? (
            <a href={EXPERT.tx(b.l1TxHash)} target="_blank" rel="noreferrer"
              className="inline-block rounded-lg border border-border px-5 py-2 text-sm text-lab-purple hover:bg-surface">
              View on stellar.expert →
            </a>
          ) : (
            <p className="text-sm text-muted">Waiting for Stellar L1…</p>
          )}
          {data!.withdrawals.length > 0 && (
            <Card>
              <div className="border-b border-border px-5 py-4 text-sm font-semibold">Withdrawals in batch</div>
              <ul className="divide-y divide-border">
                {data!.withdrawals.map((w) => (
                  <li key={w.txId} className="flex justify-between px-5 py-3 font-mono text-sm">
                    <Link to={`/tx/${w.txId}`} className="text-lab-purple underline">{w.txId.slice(0, 12)}…</Link>
                    <span>{fmtStroops(w.amount)} → {w.recipient.slice(0, 8)}…</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <a href={`${SEQUENCER_URL}/v1/batches/${index}?data=1`} target="_blank" rel="noreferrer"
            className="text-xs text-muted underline">Download batch data (JSON)</a>
        </div>
      )}
    </div>
  );
}
