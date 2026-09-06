import { useEffect, useState } from 'react';
import { fetchHealth, SEQUENCER_URL, type Health } from '../lib/api.ts';

const TONE = {
  HEALTHY: { dot: 'bg-teal', label: 'Healthy', text: 'text-teal' },
  DEGRADED: { dot: 'bg-gold', label: 'Degraded', text: 'text-amber-600' },
  DOWN: { dot: 'bg-red-400', label: 'Down', text: 'text-red-400' },
} as const;

/** Sondea el secuenciador real. Es la pieza que hace visible la tesis del producto. */
export function useHealth(intervalMs = 4000) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number;
    const tick = async () => {
      try {
        setHealth(await fetchHealth(ctrl.signal));
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
      timer = window.setTimeout(tick, intervalMs);
    };
    void tick();
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [intervalMs]);

  return { health, error };
}

export function StatusPill({ health, onDark = false, compact = false }: { health: Health | null; onDark?: boolean; compact?: boolean }) {
  const tone = health ? TONE[health.l1.status] : null;
  const label = tone?.label ?? 'connecting…';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium ${
      onDark ? 'border-white/12 bg-white/5' : 'border-ink/12 bg-white'}`}
      title={compact ? `Stellar network: ${label}` : undefined}>
      <span className={`pulse-dot h-1.5 w-1.5 shrink-0 rounded-full ${tone?.dot ?? 'bg-warm'}`} />
      {!compact && <span className={onDark ? 'text-white/60' : 'text-ink/55'}>Network</span>}
      <span className={tone?.text ?? (onDark ? 'text-white/40' : 'text-ink/40')}>{label}</span>
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-t border-white/10 pt-4">
      <div className="font-mono text-2xl font-medium tabular-nums text-white">{value}</div>
      <div className="mt-1 text-sm text-white/50">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-white/30">{sub}</div>}
    </div>
  );
}

export function LivePanel() {
  const { health, error } = useHealth();
  const l1 = health?.l1;
  const l2 = health?.l2;

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Live testnet sequencer</h3>
          <p className="mt-1 text-sm text-white/50">
            Not a mock. This reads {' '}
            <a href={`${SEQUENCER_URL}/v1/health`} className="text-gold underline decoration-gold/30 underline-offset-4 hover:decoration-gold" target="_blank" rel="noreferrer">
              /v1/health
            </a>{' '}
            every 4 seconds.
          </p>
        </div>
        <StatusPill health={health} onDark compact />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          Can’t reach the sequencer ({error}). If this page still works, that is the point:
          Flash keeps its own state.
        </p>
      )}

      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Stat label="Stellar ledger" value={l1 ? `#${l1.latestLedger.toLocaleString('en-US')}` : '—'} sub={l1 ? `${l1.ledgerAgeSec}s ago` : undefined} />
        <Stat label="Inclusion fee p90" value={l1 ? `${l1.feeP90}` : '—'} sub="stroops" />
        <Stat label="Batches settled" value={l2 ? l2.nextBatch : '—'} sub="on Stellar L1" />
        <Stat label="Flash payments" value={l2 ? l2.seq.toLocaleString('en-US') : '—'} sub={l2 ? `${l2.accounts} accounts` : undefined} />
      </div>

      {l1 && (
        <p className="mt-8 border-t border-white/10 pt-5 text-sm text-white/45">
          <span className="text-white/70">Sequencer reads:</span> last ledger {l1.ledgerAgeSec}s old,
          inclusion fee p90 {l1.feeP90} stroops{l1.surge ? ' (surge pricing)' : ''}.{' '}
          {l1.status === 'HEALTHY'
            ? 'Batches are published as they seal.'
            : 'Batches are being held. Payments inside Flash keep confirming regardless.'}
        </p>
      )}
    </div>
  );
}
