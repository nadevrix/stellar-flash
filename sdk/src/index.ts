/**
 * @stellar-flash/sdk · cliente para desarrolladores.
 *
 * Objetivo "drop-in" (la lección de Arbitrum): un dev que ya paga en Stellar cambia
 * `server.submitTransaction(...)` por `flash.transfer(...)` y obtiene confirmación en milisegundos,
 * usando la MISMA llave Stellar (G...) y los MISMOS tokens (XLM, USDC...). Sin wallet nueva.
 *
 * Los helpers L1 (`buildDepositTx`, `buildWithdrawClaimTx`) devuelven transacciones Stellar SIN
 * firmar para que la firme el usuario (Freighter, Keypair, etc.).
 */
import { Address, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { domainSeparator, fromHex, signingMessage, signTx, toHex, type SignedTx, type TransferTx, type WithdrawTx } from '../../protocol/src/index.ts';

export interface FlashClientOptions {
  /** URL base del secuenciador, p. ej. http://localhost:8787 */
  baseUrl: string;
  /** Llave del usuario (necesaria para transfer/withdraw). */
  keypair?: Keypair;
  fetch?: typeof fetch;
}

export interface FlashReceipt {
  id: string;
  seq: number;
  type: string;
  status: 'confirmed';
  finality: { l2: 'instant'; l1: 'pending' };
  latencyUs: number;
  timestamp: number;
}

export interface FlashNetworkInfo {
  passphrase: string;
  bridgeContractId: string;
  l1Mode: string;
  allowedTokens: string[];
}

export class FlashApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class FlashClient {
  private readonly baseUrl: string;
  private readonly keypair?: Keypair;
  private readonly fetchFn: typeof fetch;
  private domainCache?: { network: FlashNetworkInfo; domain: Uint8Array };

  constructor(opts: FlashClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.keypair = opts.keypair;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } } & T;
    if (!res.ok) throw new FlashApiError(res.status, body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `HTTP ${res.status}`, body.error?.details);
    return body;
  }

  async health(): Promise<{ l2: Record<string, unknown>; l1: Record<string, unknown>; network: FlashNetworkInfo; settlement: unknown }> {
    return this.request('/health');
  }

  /** Dominio de firma (red + puente). Se cachea tras la primera llamada. */
  async domain(): Promise<Uint8Array> {
    if (!this.domainCache) {
      const h = await this.health();
      this.domainCache = { network: h.network, domain: domainSeparator({ networkPassphrase: h.network.passphrase, bridgeContractId: h.network.bridgeContractId }) };
    }
    return this.domainCache.domain;
  }

  async network(): Promise<FlashNetworkInfo> {
    await this.domain();
    return this.domainCache!.network;
  }

  async getAccount(address: string): Promise<{ account: string; balances: { token: string; balance: string; nonce: string }[]; transactions: unknown[] }> {
    return this.request(`/accounts/${address}`);
  }

  async getBalance(address: string, token: string): Promise<bigint> {
    const acc = await this.getAccount(address);
    return BigInt(acc.balances.find((b) => b.token === token)?.balance ?? '0');
  }

  async getNonce(address: string, token: string): Promise<bigint> {
    const r = await this.request<{ nonce: string }>(`/accounts/${address}/nonce?token=${encodeURIComponent(token)}`);
    return BigInt(r.nonce);
  }

  private requireKeypair(): Keypair {
    if (!this.keypair) throw new Error('FlashClient necesita un keypair para firmar');
    return this.keypair;
  }

  /** Pago en Flash: firmado con la llave Stellar del usuario y confirmado en el acto. */
  async transfer(p: { to: string; token: string; amount: bigint; nonce?: bigint }): Promise<FlashReceipt> {
    const kp = this.requireKeypair();
    const from = kp.publicKey();
    const nonce = p.nonce ?? (await this.getNonce(from, p.token));
    const tx: TransferTx = signTx({ type: 'transfer', from, to: p.to, token: p.token, amount: p.amount, nonce }, kp, await this.domain());
    return this.submitSigned({ ...tx, amount: tx.amount.toString(), nonce: tx.nonce.toString(), signature: toHex(tx.signature) });
  }

  /** Retiro L2 → L1: quema en Flash; el pago en Stellar se reclama con `buildWithdrawClaimTx` cuando el lote finaliza. */
  async withdraw(p: { token: string; amount: bigint; l1Recipient?: string; nonce?: bigint }): Promise<FlashReceipt> {
    const kp = this.requireKeypair();
    const from = kp.publicKey();
    const nonce = p.nonce ?? (await this.getNonce(from, p.token));
    const tx: WithdrawTx = signTx({ type: 'withdraw', from, token: p.token, amount: p.amount, nonce, l1Recipient: p.l1Recipient ?? from }, kp, await this.domain());
    return this.submitSigned({ ...tx, amount: tx.amount.toString(), nonce: tx.nonce.toString(), signature: toHex(tx.signature) });
  }

  /**
   * Prepara un pago para que lo firme la wallet del usuario (Freighter, xBull, Lobstr…).
   * Devuelve los bytes exactos que hay que pasar a `signMessage` (SEP-53) y la tx sin firma;
   * añade la firma en hex y envíala con `submitSigned`. No requiere keypair.
   */
  async signingMessage(
    p:
      | { type: 'transfer'; from?: string; to: string; token: string; amount: bigint; nonce?: bigint }
      | { type: 'withdraw'; from?: string; token: string; amount: bigint; l1Recipient?: string; nonce?: bigint },
  ): Promise<{ message: Uint8Array; tx: Record<string, unknown> }> {
    const from = p.from ?? this.keypair?.publicKey();
    if (!from) throw new Error('signingMessage necesita `from` o un keypair en el cliente');
    const nonce = p.nonce ?? (await this.getNonce(from, p.token));
    const unsigned =
      p.type === 'transfer'
        ? { type: 'transfer' as const, from, to: p.to, token: p.token, amount: p.amount, nonce }
        : { type: 'withdraw' as const, from, token: p.token, amount: p.amount, nonce, l1Recipient: p.l1Recipient ?? from };
    const message = signingMessage(unsigned as Omit<SignedTx, 'signature'>, await this.domain());
    const tx: Record<string, unknown> =
      unsigned.type === 'transfer'
        ? { type: 'transfer', from, to: unsigned.to, token: unsigned.token, amount: unsigned.amount.toString(), nonce: nonce.toString() }
        : { type: 'withdraw', from, token: unsigned.token, amount: unsigned.amount.toString(), nonce: nonce.toString(), l1Recipient: unsigned.l1Recipient };
    return { message, tx };
  }

  async submitSigned(txJson: Record<string, unknown>): Promise<FlashReceipt> {
    const r = await this.request<{ receipt: FlashReceipt }>('/transactions', { method: 'POST', body: JSON.stringify({ tx: txJson }) });
    return r.receipt;
  }

  async getTransaction(id: string): Promise<{ id: string; finality: { l2: string; l1: string }; batch: { index: string; status: string; l1TxHash: string | null } | null }> {
    return this.request(`/transactions/${id}`);
  }

  async getWithdrawalProof(txId: string): Promise<WithdrawalProofView> {
    return this.request(`/withdrawals/${txId}/proof`);
  }

  /** Espera a que la tx alcance un estado L1 (committed/finalized). Para la mayoría de apps NO hace falta: la L2 ya es final. */
  async waitForL1(txId: string, target: 'committed' | 'finalized' = 'committed', timeoutMs = 120_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const t = await this.getTransaction(txId);
      const s = t.finality.l1;
      if (s === 'finalized' || (target === 'committed' && s === 'committed')) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`timeout esperando ${target} para ${txId}`);
  }

  // ------------------------------------------------------------------------------------
  // Helpers L1 (Stellar). Devuelven transacciones sin firmar.
  // ------------------------------------------------------------------------------------

  /** Depósito L1 → L2: invoca `deposit(from, token, amount, l2_recipient)` en el puente. */
  async buildDepositTx(p: { server: rpc.Server; from: string; token: string; amount: bigint; l2Recipient?: string; fee?: string }) {
    const net = await this.network();
    const account = await p.server.getAccount(p.from);
    const tx = new TransactionBuilder(account, { fee: p.fee ?? '1000', networkPassphrase: net.passphrase })
      .addOperation(
        new Contract(net.bridgeContractId).call(
          'deposit',
          new Address(p.from).toScVal(),
          new Address(p.token).toScVal(),
          nativeToScVal(p.amount, { type: 'i128' }),
          new Address(p.l2Recipient ?? p.from).toScVal(),
        ),
      )
      .setTimeout(60)
      .build();
    return p.server.prepareTransaction(tx);
  }

  /** Reclama en L1 un retiro finalizado: `withdraw(batch_index, w_index, recipient, token, amount, proof)`. Cualquier cuenta puede pagarlo. */
  async buildWithdrawClaimTx(p: { server: rpc.Server; source: string; proof: WithdrawalProofView; fee?: string }) {
    const net = await this.network();
    if (!p.proof.claimable) throw new Error('el lote aún no está finalizado: espera el periodo de desafío');
    const account = await p.server.getAccount(p.source);
    const tx = new TransactionBuilder(account, { fee: p.fee ?? '1000', networkPassphrase: net.passphrase })
      .addOperation(
        new Contract(net.bridgeContractId).call(
          'withdraw',
          nativeToScVal(BigInt(p.proof.batchIndex), { type: 'u64' }),
          nativeToScVal(p.proof.wIndex, { type: 'u32' }),
          new Address(p.proof.recipient).toScVal(),
          new Address(p.proof.token).toScVal(),
          nativeToScVal(BigInt(p.proof.amount), { type: 'i128' }),
          xdr.ScVal.scvVec(p.proof.proof.map((h) => xdr.ScVal.scvBytes(Buffer.from(fromHex(h))))),
        ),
      )
      .setTimeout(60)
      .build();
    return p.server.prepareTransaction(tx);
  }
}

export interface WithdrawalProofView {
  txId: string;
  batchIndex: string;
  wIndex: number;
  recipient: string;
  token: string;
  amount: string;
  proof: string[];
  withdrawalsRoot: string;
  batchStatus: string;
  l1TxHash: string | null;
  commitLedger: number | null;
  claimable: boolean;
}

export { Keypair } from '@stellar/stellar-sdk';
