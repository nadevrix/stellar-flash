import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHealth } from '../components/LiveStatus.tsx';
import { Alert, Card, CardHeader, PageHeader, StatTile } from '../components/ui/Lab.tsx';
import {
  SEQUENCER_URL, fetchBatches, fetchL1History, fetchStats, fetchTxs,
  type BatchRow, type HealthPoint, type Stats, type TxRow,
} from '../lib/api.ts';
import { EXPERT, ms, ago, short } from '../lib/format.ts';

function usePoll<T>(fn: (s: AbortSignal) => Promise<T>, everyMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number;
    const tick = async () => {
      try { setData(await fn(ctrl.signal)); } catch { /* reintenta */ }
      timer = window.setTimeout(tick, everyMs);
    };
    void tick();
    return () => { ctrl.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs]);
  return data;
}

const BATCH_TONE: Record<BatchRow['status'], string> = {
  sealed: 'border-border text-muted bg-surface',
  committed: 'border-teal/30 text-teal bg-teal/5',
  finalized: 'border-lab-purple/30 text-lab-purple bg-lab-purple/5',
};

const TYPE_TONE: Record<TxRow['type'], string> = {
  deposit: 'border-teal/30 text-teal bg-teal/5',
  transfer: 'border-border text-muted bg-surface',
  withdraw: 'border-gold/40 text-amber-700 bg-gold/10',
};

function HealthStrip({ points }: { points: HealthPoint[] }) {
  if (points.length === 0) return <p className="px-5 py-8 text-sm text-muted">No probes yet.</p>;
  return (
    <div className="px-5 py-5">
      <div className="flex h-16 items-end gap-[3px]">
        {points.map((p, i) => {
          const h = p.status === 'DOWN' ? 100 : Math.min(100, 22 + p.ledgerAgeSec * 5);
          const c = p.status === 'DOWN' ? 'bg-red-400/80' : p.status === 'DEGRADED' ? 'bg-gold/80' : 'bg-teal/70';
          return (
            <div key={i} className={`flex-1 rounded-sm ${c}`} style={{ height: `${h}%` }}
                 title={`${new Date(p.at).toLocaleTimeString()} · ${p.status} · ledger ${p.latestLedger}`} />
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Each bar is a probe to Stellar RPC. Red = network down — Flash payments keep confirming anyway.
      </p>
    </div>
  );
}

export function Explorer() {
  const { health, error: healthError } = useHealth(3000);
  const txs = usePoll(fetchTxs.bind(null, 25), 2000);
  const batches = usePoll(fetchBatches.bind(null, 12), 4000);
  const stats = usePoll<Stats>((s) => fetchStats(60, s), 5000);
  const history = usePoll(fetchL1History, 5000);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Transactions"
        title="Live network feed"
        description="Every Flash payment, batch settlement on Stellar, and network health — polled from the sequencer."
      />

      {healthError && (
        <Alert tone="error">
          Cannot reach the sequencer ({healthError}). Restart <strong>stellar-flash-sequencer</strong> on Render.
        </Alert>
      )}

      <Card className="mb-6 grid overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Confirmation p50" value={stats ? ms(stats.l2.latencyP50Us) : '—'} sub={stats ? `p99 ${ms(stats.l2.latencyP99Us)}` : undefined} />
        <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Payments / sec" value={stats ? stats.l2.txsPerSec.toFixed(2) : '—'} sub={stats ? `${stats.l2.txs} in ${stats.windowSec}s` : undefined} /></div>
        <div className="border-t border-border lg:border-t-0 lg:border-l"><StatTile label="Batches on Stellar" value={stats ? String(stats.l1.batchesCommitted) : '—'} /></div>
        <div className="border-t border-border lg:border-t-0 lg:border-l"><StatTile label="Accounts" value={stats ? String(stats.l2.accounts) : '—'} sub={stats ? `${stats.l2.totalTxs} payments total` : undefined} /></div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader title="Live payments" hint="every 2s" />
          {!txs ? (
            <p className="px-5 py-8 text-sm text-muted">Connecting to the sequencer…</p>
          ) : txs.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {txs.map((t) => <TxLine key={t.id} t={t} />)}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Stellar network health" hint={health ? `ledger #${health.l1.latestLedger.toLocaleString()}` : undefined} />
            <HealthStrip points={history ?? []} />
          </Card>

          <Card>
            <CardHeader title="Batches" hint="settled on Stellar" />
            {!batches ? (
              <p className="px-5 py-8 text-sm text-muted">Loading…</p>
            ) : (
              <ul className="divide-y divide-border">
                {batches.map((b) => (
                  <li key={b.index} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link to={`/batches/${b.index}`} className="min-w-0 flex-1 hover:opacity-80">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">#{b.index}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${BATCH_TONE[b.status]}`}>{b.status}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {b.txCount} tx · sealed {ago(b.sealedAt)} ago
                      </div>
                    </Link>
                    {b.l1TxHash ? (
                      <a href={EXPERT.tx(b.l1TxHash)} target="_blank" rel="noreferrer"
                         className="shrink-0 font-mono text-xs text-lab-purple underline">{short(b.l1TxHash)}</a>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">waiting for L1</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        Reading{' '}
        <a href={`${SEQUENCER_URL}/v1/health`} target="_blank" rel="noreferrer" className="text-lab-purple underline">
          {SEQUENCER_URL.replace('https://', '')}
        </a>
        {' · '}testnet assets have no value
      </p>
    </div>
  );
}

function TxLine({ t }: { t: TxRow }) {
  const addr = t.type === 'deposit' ? t.to : t.type === 'withdraw' ? t.from : null;
  const who = t.type === 'transfer' ? `${short(t.from ?? '', 4)} → ${short(t.to ?? '', 4)}` : short(addr ?? '', 6);
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-surface">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link to={`/tx/${t.id}`} className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${TYPE_TONE[t.type]}`}>{t.type}</Link>
        {addr ? (
          <Link to={`/accounts/${addr}`} className="truncate font-mono text-sm text-ink hover:text-lab-purple">{who}</Link>
        ) : (
          <Link to={`/tx/${t.id}`} className="truncate font-mono text-sm text-muted">{who}</Link>
        )}
      </div>
      <Link to={`/tx/${t.id}`} className="flex shrink-0 items-center gap-4 text-right">
        <span className="font-mono text-sm tabular-nums">{(Number(t.amount) / 1e7).toFixed(2)}</span>
        <span className="w-20 font-mono text-xs tabular-nums text-lab-purple">{ms(t.latencyUs)}</span>
        <span className="w-16 font-mono text-xs text-muted">{t.batchIndex === null ? 'pending' : `#${t.batchIndex}`}</span>
      </Link>
    </li>
  );
}
