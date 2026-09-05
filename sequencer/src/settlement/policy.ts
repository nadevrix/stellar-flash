/**
 * Política de settlement: dado el estado de salud de la L1 y un lote sellado, decide si publicar
 * ahora, diferir o esperar. Es una función pura para poder testearla exhaustivamente.
 *
 * Principio: "publicar cuando Stellar esté sana". Excepciones: un lote con retiros o que lleva
 * demasiado tiempo esperando se publica aunque haya surge pricing (pagando la fee que haga falta,
 * hasta `maxInclusionFeeStroops`), porque los usuarios que salen a L1 dependen de ese commit.
 */
import type { HealthSnapshot } from './health.ts';

export interface PolicyConfig {
  minInclusionFeeStroops: number;
  maxInclusionFeeStroops: number;
  maxDeferMs: number;
  /** Backoff base entre reintentos fallidos (ms). */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface BatchForPolicy {
  sealedAt: number;
  hasWithdrawals: boolean;
  attempts: number;
  lastAttemptAt: number | null;
  lastErrorKind?: string | null;
}

export type SettlementAction = 'COMMIT' | 'DEFER' | 'HOLD';

export interface SettlementDecision {
  action: SettlementAction;
  maxInclusionFeeStroops: number;
  reason: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function retryDelayMs(attempts: number, baseMs = 5_000, maxMs = 120_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

export function decideSettlement(health: HealthSnapshot, batch: BatchForPolicy, now: number, cfg: PolicyConfig): SettlementDecision {
  const waitedMs = now - batch.sealedAt;
  const urgent = batch.hasWithdrawals || waitedMs >= cfg.maxDeferMs;

  // Backoff tras fallos (evita martillar un RPC que devuelve TRY_AGAIN_LATER o errores).
  if (batch.attempts > 0 && batch.lastAttemptAt !== null) {
    const wait = retryDelayMs(batch.attempts, cfg.retryBaseMs, cfg.retryMaxMs);
    if (now - batch.lastAttemptAt < wait) {
      return { action: 'DEFER', maxInclusionFeeStroops: 0, reason: `backoff tras ${batch.attempts} intento(s); reintento en ${Math.ceil((wait - (now - batch.lastAttemptAt)) / 1000)}s` };
    }
  }

  if (health.status === 'DOWN') {
    return { action: 'HOLD', maxInclusionFeeStroops: 0, reason: `L1 caída (${health.reason}); Flash sigue operando, el lote espera` };
  }

  const p90 = health.feeP90 ?? cfg.minInclusionFeeStroops;
  if (health.status === 'DEGRADED') {
    if (!urgent) {
      return { action: 'DEFER', maxInclusionFeeStroops: 0, reason: `L1 degradada (${health.reason}); lote sin retiros, difiriendo hasta ${Math.ceil((cfg.maxDeferMs - waitedMs) / 1000)}s más` };
    }
    // Urgente: pujar agresivo (2x p90 + escalado por intentos), sin pasar el tope.
    const fee = clamp(Math.ceil(p90 * 2 * (1 + 0.5 * batch.attempts)), cfg.minInclusionFeeStroops, cfg.maxInclusionFeeStroops);
    return { action: 'COMMIT', maxInclusionFeeStroops: fee, reason: `L1 degradada pero lote urgente (${batch.hasWithdrawals ? 'tiene retiros' : `esperó ${Math.round(waitedMs / 1000)}s`}); puja ${fee} stroops` };
  }

  // HEALTHY: puja 1.5x p90 (mínimo configurado), escalando si hubo intentos fallidos.
  const fee = clamp(Math.ceil(p90 * 1.5 * (1 + 0.5 * batch.attempts)), cfg.minInclusionFeeStroops, cfg.maxInclusionFeeStroops);
  return { action: 'COMMIT', maxInclusionFeeStroops: fee, reason: `L1 sana; puja ${fee} stroops (p90=${p90})` };
}
