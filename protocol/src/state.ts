/**
 * Máquina de estado del rollup de pagos Stellar Flash.
 *
 * Es **determinista y pura**: dado el mismo estado inicial y la misma secuencia de transacciones
 * produce la misma raíz Merkle. Por eso cualquiera (un "watchtower", un exchange, el propio
 * usuario) puede descargar los lotes publicados en L1 y re-ejecutarlos para verificar que el
 * secuenciador no mintió (`replayBatch`). Esa es la base de las pruebas de fraude (fase 2).
 */
import { compareBytes, toHex } from './bytes.ts';
import { buildTree, getProof, stateKeyBytes, stateLeaf, withdrawalLeaf } from './merkle.ts';
import type { DepositTx, L2Tx, TransferTx, WithdrawTx } from './tx.ts';
import { verifyTxSignature } from './tx.ts';

export interface AccountState {
  balance: bigint;
  nonce: bigint;
}

export type FlashErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_ADDRESS'
  | 'INVALID_SIGNATURE'
  | 'BAD_NONCE'
  | 'INSUFFICIENT_BALANCE'
  | 'SELF_TRANSFER'
  | 'DEPOSIT_OUT_OF_ORDER'
  | 'TOKEN_NOT_ALLOWED';

export class FlashError extends Error {
  readonly code: FlashErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: FlashErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface WithdrawalRecord {
  wIndex: number;
  recipient: string;
  token: string;
  amount: bigint;
}

export interface StateLeafInfo {
  account: string;
  token: string;
  balance: bigint;
  nonce: bigint;
  leaf: Uint8Array;
}

export interface BalanceProof {
  account: string;
  token: string;
  balance: bigint;
  nonce: bigint;
  leafIndex: number;
  proof: Uint8Array[];
  root: Uint8Array;
}

const key = (account: string, token: string) => `${account}|${token}`;

export interface FlashStateOptions {
  /** Si se define, solo se aceptan estos tokens (direcciones de contrato). */
  allowedTokens?: Set<string>;
}

export class FlashState {
  private readonly accounts = new Map<string, AccountState>();
  private readonly domain: Uint8Array;
  private readonly allowedTokens?: Set<string>;
  /** Próximo índice de depósito L1 que se espera ingerir (== deposit_cursor). */
  nextDepositIndex = 0n;

  constructor(domain: Uint8Array, opts: FlashStateOptions = {}) {
    this.domain = domain;
    this.allowedTokens = opts.allowedTokens;
  }

  get(account: string, token: string): AccountState {
    return this.accounts.get(key(account, token)) ?? { balance: 0n, nonce: 0n };
  }

  get size(): number {
    return this.accounts.size;
  }

  private checkToken(token: string) {
    if (this.allowedTokens && !this.allowedTokens.has(token)) {
      throw new FlashError('TOKEN_NOT_ALLOWED', `token no habilitado en Flash: ${token}`);
    }
  }

  /** Valida sin mutar. Lanza `FlashError` si la tx es inválida en el estado actual. */
  validate(tx: L2Tx): void {
    if (tx.amount <= 0n) throw new FlashError('INVALID_AMOUNT', 'el monto debe ser > 0');
    this.checkToken(tx.token);
    if (tx.type === 'deposit') {
      if (tx.depositIndex !== this.nextDepositIndex) {
        throw new FlashError('DEPOSIT_OUT_OF_ORDER', `se esperaba depósito #${this.nextDepositIndex}, llegó #${tx.depositIndex}`);
      }
      return;
    }
    if (tx.type === 'transfer' && tx.from === tx.to) throw new FlashError('SELF_TRANSFER', 'from == to');
    if (!verifyTxSignature(tx, this.domain)) throw new FlashError('INVALID_SIGNATURE', 'firma ed25519 inválida');
    const acc = this.get(tx.from, tx.token);
    if (tx.nonce !== acc.nonce) {
      throw new FlashError('BAD_NONCE', `nonce esperado ${acc.nonce}, recibido ${tx.nonce}`, { expected: acc.nonce.toString() });
    }
    if (acc.balance < tx.amount) {
      throw new FlashError('INSUFFICIENT_BALANCE', `saldo ${acc.balance} < ${tx.amount}`, { balance: acc.balance.toString() });
    }
  }

  private credit(account: string, token: string, amount: bigint) {
    const k = key(account, token);
    const cur = this.accounts.get(k) ?? { balance: 0n, nonce: 0n };
    this.accounts.set(k, { balance: cur.balance + amount, nonce: cur.nonce });
  }

  private debitAndBump(account: string, token: string, amount: bigint) {
    const k = key(account, token);
    const cur = this.accounts.get(k) ?? { balance: 0n, nonce: 0n };
    this.accounts.set(k, { balance: cur.balance - amount, nonce: cur.nonce + 1n });
  }

  applyDeposit(tx: DepositTx): void {
    this.validate(tx);
    this.credit(tx.to, tx.token, tx.amount);
    this.nextDepositIndex += 1n;
  }

  applyTransfer(tx: TransferTx): void {
    this.validate(tx);
    this.debitAndBump(tx.from, tx.token, tx.amount);
    this.credit(tx.to, tx.token, tx.amount);
  }

  /** Quema el saldo en L2 y devuelve el registro para la hoja de retiro (el índice lo asigna el lote). */
  applyWithdraw(tx: WithdrawTx): Omit<WithdrawalRecord, 'wIndex'> {
    this.validate(tx);
    this.debitAndBump(tx.from, tx.token, tx.amount);
    return { recipient: tx.l1Recipient, token: tx.token, amount: tx.amount };
  }

  apply(tx: L2Tx): Omit<WithdrawalRecord, 'wIndex'> | undefined {
    switch (tx.type) {
      case 'deposit':
        this.applyDeposit(tx);
        return undefined;
      case 'transfer':
        this.applyTransfer(tx);
        return undefined;
      case 'withdraw':
        return this.applyWithdraw(tx);
    }
  }

  /** Hojas en orden canónico (por bytes de xdr(account)||xdr(token)). */
  leaves(): StateLeafInfo[] {
    const rows: { k: Uint8Array; info: StateLeafInfo }[] = [];
    for (const [k, st] of this.accounts) {
      const [account, token] = k.split('|');
      rows.push({
        k: stateKeyBytes(account, token),
        info: { account, token, balance: st.balance, nonce: st.nonce, leaf: stateLeaf(account, token, st.balance, st.nonce) },
      });
    }
    rows.sort((a, b) => compareBytes(a.k, b.k));
    return rows.map((r) => r.info);
  }

  root(): Uint8Array {
    return buildTree(this.leaves().map((l) => l.leaf)).root;
  }

  rootHex(): string {
    return toHex(this.root());
  }

  /** Prueba Merkle del saldo de una cuenta contra la raíz actual (para `escape` en el puente). */
  proofFor(account: string, token: string): BalanceProof {
    const leaves = this.leaves();
    const idx = leaves.findIndex((l) => l.account === account && l.token === token);
    if (idx < 0) throw new Error('la cuenta no existe en el estado');
    const tree = buildTree(leaves.map((l) => l.leaf));
    const l = leaves[idx];
    return { account, token, balance: l.balance, nonce: l.nonce, leafIndex: idx, proof: getProof(tree, idx), root: tree.root };
  }

  snapshot(): { nextDepositIndex: string; accounts: [string, string, string, string][] } {
    const accounts: [string, string, string, string][] = [];
    for (const [k, st] of this.accounts) {
      const [account, token] = k.split('|');
      accounts.push([account, token, st.balance.toString(), st.nonce.toString()]);
    }
    return { nextDepositIndex: this.nextDepositIndex.toString(), accounts };
  }

  static fromSnapshot(domain: Uint8Array, snap: ReturnType<FlashState['snapshot']>, opts?: FlashStateOptions): FlashState {
    const s = new FlashState(domain, opts);
    s.nextDepositIndex = BigInt(snap.nextDepositIndex);
    for (const [account, token, balance, nonce] of snap.accounts) {
      s.accounts.set(key(account, token), { balance: BigInt(balance), nonce: BigInt(nonce) });
    }
    return s;
  }

  clone(): FlashState {
    return FlashState.fromSnapshot(this.domain, this.snapshot(), { allowedTokens: this.allowedTokens });
  }
}

/** Raíz de retiros de un lote: hojas en orden de `wIndex`. */
export function withdrawalsTree(batchIndex: bigint, withdrawals: WithdrawalRecord[]) {
  return buildTree(withdrawals.map((w) => withdrawalLeaf(batchIndex, w.wIndex, w.recipient, w.token, w.amount)));
}

export interface ReplayResult {
  ok: boolean;
  newStateRoot: Uint8Array;
  withdrawalsRoot: Uint8Array;
  withdrawals: WithdrawalRecord[];
  failedTxIndex?: number;
  error?: string;
}

/**
 * Re-ejecuta un lote sobre `state` (mutándolo) y devuelve las raíces resultantes. Si alguna tx
 * es inválida, el lote es inválido: un secuenciador honesto nunca incluye txs inválidas.
 * Comparar `newStateRoot` con la raíz publicada en L1 = detección de fraude.
 */
export function replayBatch(state: FlashState, batchIndex: bigint, txs: L2Tx[]): ReplayResult {
  const withdrawals: WithdrawalRecord[] = [];
  for (let i = 0; i < txs.length; i++) {
    try {
      const w = state.apply(txs[i]);
      if (w) withdrawals.push({ wIndex: withdrawals.length, ...w });
    } catch (e) {
      return {
        ok: false,
        newStateRoot: state.root(),
        withdrawalsRoot: withdrawalsTree(batchIndex, withdrawals).root,
        withdrawals,
        failedTxIndex: i,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { ok: true, newStateRoot: state.root(), withdrawalsRoot: withdrawalsTree(batchIndex, withdrawals).root, withdrawals };
}
