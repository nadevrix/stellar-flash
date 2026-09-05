import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo.tsx';
import { useHealth } from '../components/LiveStatus.tsx';
import {
  SEQUENCER_URL, fetchBatches, fetchL1History, fetchStats, fetchTxs,
  type BatchRow, type HealthPoint, type Stats, type TxRow,
} from '../lib/api.ts';

const EXPERT_TX = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const short = (s: string, n = 6) => `${s.slice(0, n)}…${s.slice(-4)}`;
const ms = (us: number) => `${(us / 1000).toFixed(us < 10_000 ? 2 : 0)} ms`;
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

/** Sondea `fn` cada `everyMs`. Un fallo puntual no borra lo que ya se mostraba. */
function usePoll<T>(fn: (s: AbortSignal) => Promise<T>, everyMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number;
    const tick = async () => {
      try { setData(await fn(ctrl.signal)); } catch { /* se reintenta en el siguiente ciclo */ }
      timer = window.setTimeout(tick, everyMs);
    };
    void tick();
    return () => { ctrl.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs]);
  return data;
}

const STATUS = {
  HEALTHY: { label: 'Healthy', dot: 'bg-teal', text: 'text-teal' },
  DEGRADED: { label: 'Degraded', dot: 'bg-gold', text: 'text-gold' },
  DOWN: { label: 'Down', dot: 'bg-red-400', text: 'text-red-400' },
} as const;

const BATCH_TONE: Record<BatchRow['status'], string> = {
  sealed: 'border-white/20 text-white/60',
  committed: 'border-gold/40 text-gold',
  finalized: 'border-teal/40 text-teal',
};

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/12 bg-white/[0.02] ${className}`}>
      <header className="flex items-baseline justify-between border-b border-white/10 px-5 py-3.5">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {hint && <span className="font-mono text-xs text-white/35">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="font-mono text-2xl font-medium tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-white/50">{label}</div>
      {sub && <div className="text-xs text-white/30">{sub}</div>}
    </div>
  );
}

/** Historia de salud de la L1: cada barra es una sonda. Aquí se ve la tesis del producto. */
function HealthStrip({ points }: { points: HealthPoint[] }) {
  if (points.length === 0) return <p className="px-5 py-8 text-sm text-white/40">Sin sondas todavía.</p>;
  return (
    <div className="px-5 py-5">
      <div className="flex h-16 items-end gap-[3px]">
        {points.map((p, i) => {
          const h = p.status === 'DOWN' ? 100 : Math.min(100, 22 + p.ledgerAgeSec * 5);
          const c = p.status === 'DOWN' ? 'bg-red-400/80' : p.status === 'DEGRADED' ? 'bg-gold/80' : 'bg-teal/70';
          return (
            <div key={i} className={`flex-1 rounded-sm ${c}`} style={{ height: `${h}%` }}
                 title={`${new Date(p.at).toLocaleTimeString()} · ${p.status} · ledger ${p.latestLedger} (${p.ledgerAgeSec}s) · fee p90 ${p.feeP90}`} />
          );
        })}
      </div>
      <p className="mt-3 text-xs text-white/35">
        Each bar is a probe to Stellar’s RPC; taller means an older ledger.
        Red means the network is down — and Flash payments keep confirming anyway.
      </p>
    </div>
  );
}

export function Explorer() {
  const { health } = useHealth(3000);
  const txs = usePoll(fetchTxs.bind(null, 25), 2000);
  const batches = usePoll(fetchBatches.bind(null, 12), 4000);
  const stats = usePoll<Stats>((s) => fetchStats(60, s), 5000);
  const history = usePoll(fetchL1History, 5000);
  const tone = health ? STATUS[health.l1.status] : null;

  return (
    <div className="min-h-dvh bg-ink font-sans text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-5">
            <a href="/"><Logo onDark /></a>
            <span className="hidden font-mono text-xs text-white/35 sm:inline">explorer</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-white/12 px-3 py-1.5 font-mono text-xs text-white/55">testnet</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium">
              <span className={`pulse-dot h-1.5 w-1.5 rounded-full ${tone?.dot ?? 'bg-warm'}`} />
              <span className="text-white/60">Stellar</span>
              <span className={tone?.text ?? 'text-white/40'}>{tone?.label ?? '…'}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Métricas */}
        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/12 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-ink"><Metric label="Confirmation p50" value={stats ? ms(stats.l2.latencyP50Us) : '—'} sub={stats ? `p99 ${ms(stats.l2.latencyP99Us)}` : undefined} /></div>
          <div className="bg-ink"><Metric label="Payments per second" value={stats ? stats.l2.txsPerSec.toFixed(2) : '—'} sub={stats ? `${stats.l2.txs} in the last ${stats.windowSec}s` : undefined} /></div>
          <div className="bg-ink"><Metric label="Batches on Stellar" value={stats ? String(stats.l1.batchesCommitted) : '—'} sub={stats?.l1.avgSealToCommitMs !== null && stats ? `${(stats.l1.avgSealToCommitMs! / 1000).toFixed(1)}s from seal to L1` : undefined} /></div>
          <div className="bg-ink"><Metric label="Accounts" value={stats ? String(stats.l2.accounts) : '—'} sub={stats ? `${stats.l2.totalTxs} payments total` : undefined} /></div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* Feed */}
          <Panel title="Live payments" hint="every 2s">
            {!txs ? (
              <p className="px-5 py-8 text-sm text-white/40">Connecting to the sequencer…</p>
            ) : txs.length === 0 ? (
              <p className="px-5 py-8 text-sm text-white/40">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-white/8">
                {txs.map((t) => <TxLine key={t.id} t={t} />)}
              </ul>
            )}
          </Panel>

          <div className="space-y-6">
            {/* Salud L1 */}
            <Panel title="Stellar network health" hint={health ? `ledger #${health.l1.latestLedger.toLocaleString('en-US')}` : undefined}>
              <HealthStrip points={history ?? []} />
            </Panel>

            {/* Lotes */}
            <Panel title="Batches" hint="settled on Stellar">
              {!batches ? (
                <p className="px-5 py-8 text-sm text-white/40">Loading…</p>
              ) : (
                <ul className="divide-y divide-white/8">
                  {batches.map((b) => (
                    <li key={b.index} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">#{b.index}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${BATCH_TONE[b.status]}`}>{b.status}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-white/40">
                          {b.txCount} tx · {b.txDataBytes} B · sealed {ago(b.sealedAt)} ago
                        </div>
                      </div>
                      {b.l1TxHash ? (
                        <a href={EXPERT_TX(b.l1TxHash)} target="_blank" rel="noreferrer"
                           className="shrink-0 font-mono text-xs text-white/50 underline decoration-white/20 underline-offset-4 hover:text-gold">
                          {short(b.l1TxHash)}
                        </a>
                      ) : (
                        <span className="shrink-0 font-mono text-xs text-white/25">waiting for L1</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/30">
          Reading{' '}
          <a href={`${SEQUENCER_URL}/v1/health`} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-gold">
            {SEQUENCER_URL.replace('https://', '')}
          </a>{' '}
          · testnet assets have no value
        </p>
      </main>
    </div>
  );
}

const TYPE_TONE: Record<TxRow['type'], string> = {
  deposit: 'border-teal/40 text-teal',
  transfer: 'border-white/20 text-white/70',
  withdraw: 'border-gold/40 text-gold',
};

function TxLine({ t }: { t: TxRow }) {
  const who = t.type === 'deposit' ? t.to : t.type === 'withdraw' ? t.from : `${short(t.from ?? '', 4)} → ${short(t.to ?? '', 4)}`;
  return (
    <li className="rise flex items-center justify-between gap-4 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${TYPE_TONE[t.type]}`}>{t.type}</span>
        <span className="truncate font-mono text-sm text-white/70">{t.type === 'transfer' ? who : short(who ?? '', 6)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-right">
        <span className="font-mono text-sm tabular-nums">{(Number(t.amount) / 1e7).toFixed(2)}</span>
        <span className="w-20 font-mono text-xs tabular-nums text-gold">{ms(t.latencyUs)}</span>
        <span className="w-16 font-mono text-xs text-white/30">{t.batchIndex === null ? 'pending' : `#${t.batchIndex}`}</span>
      </div>
    </li>
  );
}
