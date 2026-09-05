/**
 * Monitor de salud de la L1. Sondea todos los endpoints RPC y resume el estado en un
 * `HealthSnapshot` con tres niveles:
 *
 *  - HEALTHY : algún endpoint responde y su último ledger es reciente; fees normales.
 *  - DEGRADED: responde pero el ledger está atrasado (nodo/RPC rezagado) o hay surge pricing
 *              (p90 de fee de inclusión alto). Publicar ahora es caro o poco fiable.
 *  - DOWN    : ningún endpoint responde, o el último ledger conocido es demasiado viejo.
 *
 * Este es el "sensor" con el que Flash decide *cuándo* publicar en Stellar. La experiencia del
 * usuario en L2 no cambia con el estado de la L1.
 */
import type { EndpointProbe, L1Client } from './l1.ts';

export type L1Status = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface HealthSnapshot {
  status: L1Status;
  at: number;
  latestLedger: number | null;
  ledgerAgeSec: number | null;
  feeP50: number | null;
  feeP90: number | null;
  surge: boolean;
  okEndpoints: number;
  totalEndpoints: number;
  bestEndpoint: string | null;
  reason: string;
  probes: EndpointProbe[];
}

export interface HealthThresholds {
  healthyLedgerAgeSec: number;
  downLedgerAgeSec: number;
  surgeFeeStroops: number;
}

/** Función pura: convierte sondas en un diagnóstico. */
export function evaluateHealth(probes: EndpointProbe[], th: HealthThresholds, nowMs: number): HealthSnapshot {
  const ok = probes.filter((p) => p.ok && p.latestLedger !== undefined);
  const base = { at: nowMs, okEndpoints: ok.length, totalEndpoints: probes.length, probes };
  if (ok.length === 0) {
    return { ...base, status: 'DOWN', latestLedger: null, ledgerAgeSec: null, feeP50: null, feeP90: null, surge: false, bestEndpoint: null, reason: 'ningún endpoint RPC responde' };
  }
  // El "mejor" endpoint es el que conoce el ledger más reciente (desempate: menor latencia).
  ok.sort((a, b) => (b.latestLedger! - a.latestLedger!) || (a.latencyMs - b.latencyMs));
  const best = ok[0];
  const nowSec = Math.floor(nowMs / 1000);
  const ledgerAgeSec = best.latestLedgerCloseTime !== undefined ? Math.max(0, nowSec - best.latestLedgerCloseTime) : null;
  const feeP50 = best.feeP50 ?? null;
  const feeP90 = best.feeP90 ?? null;
  const surge = feeP90 !== null && feeP90 >= th.surgeFeeStroops;

  let status: L1Status = 'HEALTHY';
  let reason = `ledger ${best.latestLedger} hace ${ledgerAgeSec ?? '?'}s; fee p90 ${feeP90 ?? '?'} stroops`;
  if (ledgerAgeSec !== null && ledgerAgeSec >= th.downLedgerAgeSec) {
    status = 'DOWN';
    reason = `último ledger conocido tiene ${ledgerAgeSec}s (≥ ${th.downLedgerAgeSec}s): red o RPC detenidos`;
  } else if (ledgerAgeSec !== null && ledgerAgeSec >= th.healthyLedgerAgeSec) {
    status = 'DEGRADED';
    reason = `ledger atrasado ${ledgerAgeSec}s (≥ ${th.healthyLedgerAgeSec}s): RPC rezagado o consenso lento`;
  } else if (surge) {
    status = 'DEGRADED';
    reason = `surge pricing: fee p90 ${feeP90} stroops ≥ ${th.surgeFeeStroops}`;
  } else if (ok.length < probes.length) {
    reason += `; ${probes.length - ok.length}/${probes.length} endpoints caídos (failover activo)`;
  }
  return { ...base, status, latestLedger: best.latestLedger!, ledgerAgeSec, feeP50, feeP90, surge, bestEndpoint: best.endpoint, reason };
}

export class L1HealthMonitor {
  private readonly l1: L1Client;
  private readonly th: HealthThresholds;
  private readonly timeoutMs: number;
  private snapshot: HealthSnapshot;
  private readonly listeners: ((h: HealthSnapshot, prev: HealthSnapshot) => void)[] = [];
  readonly history: HealthSnapshot[] = [];

  constructor(l1: L1Client, th: HealthThresholds, timeoutMs: number) {
    this.l1 = l1;
    this.th = th;
    this.timeoutMs = timeoutMs;
    this.snapshot = {
      status: 'DOWN', at: 0, latestLedger: null, ledgerAgeSec: null, feeP50: null, feeP90: null, surge: false,
      okEndpoints: 0, totalEndpoints: l1.endpoints.length, bestEndpoint: null, reason: 'sin sondear todavía', probes: [],
    };
  }

  current(): HealthSnapshot {
    return this.snapshot;
  }

  onChange(fn: (h: HealthSnapshot, prev: HealthSnapshot) => void) {
    this.listeners.push(fn);
  }

  async probe(now = Date.now()): Promise<HealthSnapshot> {
    let probes: import('./l1.ts').EndpointProbe[];
    try {
      probes = await this.l1.probe(this.timeoutMs);
    } catch (e) {
      probes = this.l1.endpoints.map((endpoint) => ({ endpoint, ok: false, latencyMs: this.timeoutMs, error: e instanceof Error ? e.message : String(e) }));
    }
    const prev = this.snapshot;
    const next = evaluateHealth(probes, this.th, now);
    this.snapshot = next;
    this.history.push(next);
    if (this.history.length > 720) this.history.shift();
    if (prev.status !== next.status) for (const fn of this.listeners) fn(next, prev);
    return next;
  }
}
