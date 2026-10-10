/**
 * Topes del piloto (mainnet limitado o testnet cerrado).
 *
 * No sustituyen una auditoría ni pruebas de fraude. Evitan que un allowlist
 * pequeño mueva más XLM del que el operador acepta perder.
 */
import { isValidL2Address } from '../../protocol/src/index.ts';
import type { FlashState } from '../../protocol/src/index.ts';

export interface FlashLimits {
  /** Vacío = abierto (solo testnet). */
  allowlist: Set<string>;
  accountCapStroops: bigint;
  vaultCapStroops: bigint;
}

export type LimitCode = 'NOT_ALLOWLISTED' | 'ACCOUNT_CAP' | 'VAULT_CAP';

export interface LimitOk {
  ok: true;
}

export interface LimitDeny {
  ok: false;
  code: LimitCode;
  message: string;
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function outstanding(state: FlashState, token: string): bigint {
  let n = 0n;
  for (const l of state.leaves()) if (l.token === token) n += l.balance;
  return n;
}

export function isAllowlisted(limits: FlashLimits | null, address: string): boolean {
  if (!limits || limits.allowlist.size === 0) return true;
  return limits.allowlist.has(address);
}

/** ¿Puede esta cuenta originar un pago L2? El destinatario no se filtra. Un retiro no usa esto. */
export function canSpend(limits: FlashLimits | null, from: string): LimitOk | LimitDeny {
  if (isAllowlisted(limits, from)) return { ok: true };
  return { ok: false, code: 'NOT_ALLOWLISTED', message: 'this account is not on the pilot allowlist' };
}

/** ¿Se puede acreditar `amount` FXLM a `to` sin romper topes? */
export function canCredit(
  limits: FlashLimits | null,
  to: string,
  token: string,
  amount: bigint,
  state: FlashState,
): LimitOk | LimitDeny {
  if (!limits) return { ok: true };
  if (!isAllowlisted(limits, to)) {
    return { ok: false, code: 'NOT_ALLOWLISTED', message: 'this account is not on the pilot allowlist' };
  }
  const nextAccount = state.get(to, token).balance + amount;
  if (nextAccount > limits.accountCapStroops) {
    return {
      ok: false,
      code: 'ACCOUNT_CAP',
      message: `account cap ${limits.accountCapStroops} stroops; this deposit would leave ${nextAccount}`,
    };
  }
  const nextVault = outstanding(state, token) + amount;
  if (nextVault > limits.vaultCapStroops) {
    return {
      ok: false,
      code: 'VAULT_CAP',
      message: `vault cap ${limits.vaultCapStroops} stroops; this deposit would leave ${nextVault}`,
    };
  }
  return { ok: true };
}

export function limitsView(limits: FlashLimits | null): null | {
  limited: true;
  accountCap: string;
  vaultCap: string;
  allowlistSize: number;
} {
  if (!limits) return null;
  return {
    limited: true,
    accountCap: limits.accountCapStroops.toString(),
    vaultCap: limits.vaultCapStroops.toString(),
    allowlistSize: limits.allowlist.size,
  };
}

export function accountLimitView(limits: FlashLimits | null, account: string, token: string, state: FlashState) {
  const v = limitsView(limits);
  if (!v || !limits) return null;
  const bal = state.get(account, token).balance;
  const vault = outstanding(state, token);
  const remainingAccount = limits.accountCapStroops > bal ? limits.accountCapStroops - bal : 0n;
  const remainingVault = limits.vaultCapStroops > vault ? limits.vaultCapStroops - vault : 0n;
  return {
    ...v,
    allowed: isAllowlisted(limits, account),
    balance: bal.toString(),
    remainingAccount: remainingAccount.toString(),
    remainingVault: remainingVault.toString(),
  };
}

export function buildLimits(opts: { allowlist: string[]; accountCapStroops: bigint; vaultCapStroops: bigint }): FlashLimits {
  const allowlist = new Set<string>();
  for (const a of opts.allowlist) {
    if (!isValidL2Address(a) || !a.startsWith('G')) throw new Error(`ALLOWLIST: no es una cuenta G…: ${a}`);
    allowlist.add(a);
  }
  if (opts.accountCapStroops <= 0n || opts.vaultCapStroops <= 0n) {
    throw new Error('ACCOUNT_CAP_STROOPS y VAULT_CAP_STROOPS deben ser > 0');
  }
  if (opts.accountCapStroops > opts.vaultCapStroops) {
    throw new Error('ACCOUNT_CAP_STROOPS no puede ser mayor que VAULT_CAP_STROOPS');
  }
  return { allowlist, accountCapStroops: opts.accountCapStroops, vaultCapStroops: opts.vaultCapStroops };
}
