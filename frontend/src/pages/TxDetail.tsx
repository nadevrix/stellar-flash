import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Alert, BtnPrimary, Card, PageHeader } from '../components/ui/Lab.tsx';
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
    <div className="mx-auto max-w-2xl">
      <Link to="/explorer" className="text-sm text-muted hover:text-lab-purple">← Transactions</Link>
      <PageHeader eyebrow="Transaction" title={id ? `${id.slice(0, 16)}…` : 'Transaction'} />
      {error && <Alert tone="error">{error}</Alert>}
      {!tx && !error && <p className="text-muted">Loading…</p>}
      {tx && (
        <div className="space-y-4">
          <Card className="p-5 font-mono text-sm break-all">
            <div className="text-muted">id</div>
            <div className="mt-1">{tx.id}</div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Type" value={tx.type} />
            <Stat label="Seq" value={String(tx.seq)} />
            <Stat label="L2 finality" value={tx.finality.l2} />
            <Stat label="L1 finality" value={tx.finality.l1} />
            <Stat label="Latency" value={ms(tx.latencyUs)} />
            <Stat label="When" value={new Date(tx.createdAt).toLocaleString()} />
          </div>
          {tx.batch && (
            <Card className="p-5">
              <div className="text-sm text-muted">Batch</div>
              <Link to={`/batches/${tx.batch.index}`} className="font-mono text-lg text-lab-purple underline">#{tx.batch.index}</Link>
              <span className="ml-3 rounded-full border border-border px-2 py-0.5 text-xs">{tx.batch.status}</span>
              {tx.batch.l1TxHash && (
                <a href={EXPERT.tx(tx.batch.l1TxHash)} target="_blank" rel="noreferrer"
                  className="mt-2 block font-mono text-xs text-muted underline">{tx.batch.l1TxHash}</a>
              )}
            </Card>
          )}
          {tx.type === 'withdraw' && (
            <Link to="/bridge"><BtnPrimary>Claim in Bridge</BtnPrimary></Link>
          )}
          <a href={`${SEQUENCER_URL}/v1/transactions/${tx.id}`} target="_blank" rel="noreferrer"
            className="block text-xs text-muted underline">Raw JSON</a>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-medium capitalize">{value}</div>
    </Card>
  );
}
