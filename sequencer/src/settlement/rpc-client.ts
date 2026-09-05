/**
 * Cliente L1 real: Stellar RPC + contrato `flash-bridge`.
 *
 * Aplica las buenas prácticas que la mayoría de apps sobre Stellar NO aplican y que explican el
 * "se quedó en procesando" (ver docs/01-diagnostico-problema.md):
 *  - varios endpoints RPC con failover automático;
 *  - puja de fee de inclusión basada en `getFeeStats` (la decide la política de settlement);
 *  - `sendTransaction` NO es confirmación: se hace polling de `getTransaction` hasta SUCCESS/FAILED;
 *  - `TRY_AGAIN_LATER`, timeouts y errores de red se clasifican (`L1Error.kind`) para reintentar con
 *    backoff sin duplicar lotes (el contrato rechaza índices repetidos y el motor reconcilia).
 */
import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { fromHex, toHex } from '../../../protocol/src/index.ts';
import type { DepositEvent } from '../core/sequencer.ts';
import { L1Error, type BridgeState, type CommitBatchArgs, type CommitResult, type EndpointProbe, type L1Client, type VerifiedDeposit } from './l1.ts';

/** Nombres de `Error` del contrato (contracts/flash-bridge/src/lib.rs) para logs legibles. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'Paused', 2: 'InvalidAmount', 3: 'InvalidBatchIndex', 4: 'StateRootMismatch', 5: 'InvalidDepositCursor',
  6: 'BatchNotFound', 7: 'BatchNotFinalized', 8: 'AlreadyClaimed', 9: 'InvalidProof', 10: 'SequencerAlive',
  11: 'AlreadyEscaped', 12: 'DepositNotFound', 13: 'DepositAlreadyProcessed', 14: 'InvalidConfig', 15: 'NoBatches', 16: 'EmptyBatch',
};

export function describeContractError(msg: string): string {
  return msg.replace(/Error\(Contract, #(\d+)\)/g, (_, n) => `Error(Contract, #${n} ${CONTRACT_ERRORS[Number(n)] ?? '?'})`);
}

export interface RpcClientOptions {
  rpcUrls: string[];
  networkPassphrase: string;
  bridgeContractId: string;
  sequencerKeypair: Keypair;
  /** Tiempo máximo esperando la inclusión de una tx (ms). */
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
  txTimeoutSec?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jsonRpc<T>(url: string, method: string, params: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  } finally {
    clearTimeout(t);
  }
}

export class StellarRpcL1Client implements L1Client {
  readonly endpoints: string[];
  private readonly servers: rpc.Server[];
  private readonly passphrase: string;
  private readonly bridgeId: string;
  private readonly keypair: Keypair;
  private readonly confirmTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly txTimeoutSec: number;
  private preferred = 0;

  constructor(opts: RpcClientOptions) {
    if (opts.rpcUrls.length === 0) throw new L1Error('CONFIG', 'se requiere al menos un RPC_URL');
    this.endpoints = opts.rpcUrls;
    this.servers = opts.rpcUrls.map((u) => new rpc.Server(u, { allowHttp: u.startsWith('http://') }));
    this.passphrase = opts.networkPassphrase;
    this.bridgeId = opts.bridgeContractId;
    this.keypair = opts.sequencerKeypair;
    this.confirmTimeoutMs = opts.confirmTimeoutMs ?? 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_500;
    this.txTimeoutSec = opts.txTimeoutSec ?? 60;
  }

  /** Sondea todos los endpoints en paralelo (getLatestLedger + getFeeStats). */
  async probe(timeoutMs: number): Promise<EndpointProbe[]> {
    return Promise.all(
      this.endpoints.map(async (endpoint): Promise<EndpointProbe> => {
        const t0 = performance.now();
        try {
          const [ledger, fees] = await Promise.all([
            jsonRpc<{ sequence: number; closeTime: string }>(endpoint, 'getLatestLedger', undefined, timeoutMs),
            jsonRpc<{ sorobanInclusionFee: { p50: string; p90: string } }>(endpoint, 'getFeeStats', undefined, timeoutMs).catch(() => null),
          ]);
          return {
            endpoint,
            ok: true,
            latencyMs: Math.round(performance.now() - t0),
            latestLedger: ledger.sequence,
            latestLedgerCloseTime: Number(ledger.closeTime),
            feeP50: fees ? Number(fees.sorobanInclusionFee.p50) : undefined,
            feeP90: fees ? Number(fees.sorobanInclusionFee.p90) : undefined,
          };
        } catch (e) {
          return { endpoint, ok: false, latencyMs: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }

  /** Ejecuta `fn` contra los servidores en orden de preferencia, rotando ante errores de red. */
  /**
   * `rotate`: empieza por un endpoint distinto al preferido. Se usa para verificar contra una
   * fuente diferente de la que trajo el dato; con un solo RPC configurado no cambia nada, y por
   * eso en producción conviene tener al menos dos proveedores independientes.
   */
  private async withFailover<T>(fn: (server: rpc.Server, url: string) => Promise<T>, rotate = false): Promise<T> {
    let lastErr: unknown;
    const start = rotate && this.servers.length > 1 ? this.preferred + 1 : this.preferred;
    for (let i = 0; i < this.servers.length; i++) {
      const idx = (start + i) % this.servers.length;
      try {
        const r = await fn(this.servers[idx], this.endpoints[idx]);
        if (!rotate) this.preferred = idx;
        return r;
      } catch (e) {
        lastErr = e;
        if (e instanceof L1Error && e.kind !== 'NETWORK') throw e; // error determinista: no sirve cambiar de RPC
      }
    }
    throw lastErr instanceof L1Error ? lastErr : new L1Error('NETWORK', `todos los RPC fallaron: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  private async simulateRead(server: rpc.Server, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const account = await server.getAccount(this.keypair.publicKey());
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: this.passphrase })
      .addOperation(new Contract(this.bridgeId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new L1Error('TX_FAILED', describeContractError(sim.error));
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new L1Error('TX_FAILED', `simulación sin resultado para ${method}`);
    return scValToNative(sim.result.retval);
  }

  /**
   * Lee un depósito del estado del contrato. Se consulta preferentemente por un endpoint DISTINTO
   * al que sirvió el evento: para colar un depósito falso ya no basta con mentir en un evento,
   * habría que mentir a la vez en el estado del contrato y en otro proveedor.
   */
  async getDeposit(index: bigint): Promise<VerifiedDeposit | null> {
    return this.withFailover(async (server) => {
      try {
        const d = (await this.simulateRead(server, 'get_deposit', nativeToScVal(index, { type: 'u64' }))) as
          | { from: string; token: string; amount: bigint; l2_recipient: string; ledger: number }
          | null
          | undefined;
        if (!d) return null;
        return { from: String(d.from), token: String(d.token), amount: BigInt(d.amount), l2Recipient: String(d.l2_recipient), ledger: Number(d.ledger) };
      } catch (e) {
        throw e instanceof L1Error ? e : new L1Error('NETWORK', e instanceof Error ? e.message : String(e));
      }
    }, /* rotate */ true);
  }

  /** `balance(bridge)` del contrato del token: lo que la bóveda tiene de verdad. */
  async getVaultBalance(token: string): Promise<bigint> {
    return this.withFailover(async (server) => {
      try {
        const account = await server.getAccount(this.keypair.publicKey());
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: this.passphrase })
          .addOperation(new Contract(token).call('balance', new Address(this.bridgeId).toScVal()))
          .setTimeout(30)
          .build();
        const sim = await server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) throw new L1Error('TX_FAILED', describeContractError(sim.error));
        if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new L1Error('TX_FAILED', 'simulación sin resultado para balance');
        return BigInt(scValToNative(sim.result.retval) as bigint);
      } catch (e) {
        throw e instanceof L1Error ? e : new L1Error('NETWORK', e instanceof Error ? e.message : String(e));
      }
    });
  }

  async getBridgeState(): Promise<BridgeState> {
    return this.withFailover(async (server) => {
      try {
        const cfg = (await this.simulateRead(server, 'get_config')) as Record<string, unknown>;
        const root = (await this.simulateRead(server, 'current_state_root')) as Uint8Array;
        return {
          batchCount: BigInt(cfg.batch_count as bigint),
          depositCount: BigInt(cfg.deposit_count as bigint),
          stateRoot: toHex(new Uint8Array(root)),
          lastCommitLedger: Number(cfg.last_commit_ledger),
          challengePeriodLedgers: Number(cfg.challenge_period_ledgers),
        };
      } catch (e) {
        throw e instanceof L1Error ? e : new L1Error('NETWORK', e instanceof Error ? e.message : String(e));
      }
    });
  }

  async commitBatch(args: CommitBatchArgs, maxInclusionFeeStroops: number): Promise<CommitResult> {
    return this.withFailover(async (server) => {
      let prepared;
      try {
        const account = await server.getAccount(this.keypair.publicKey());
        const op = new Contract(this.bridgeId).call(
          'commit_batch',
          nativeToScVal(args.batchIndex, { type: 'u64' }),
          xdr.ScVal.scvBytes(Buffer.from(fromHex(args.prevStateRoot))),
          xdr.ScVal.scvBytes(Buffer.from(fromHex(args.newStateRoot))),
          xdr.ScVal.scvBytes(Buffer.from(fromHex(args.withdrawalsRoot))),
          nativeToScVal(args.txCount, { type: 'u32' }),
          nativeToScVal(args.depositCursor, { type: 'u64' }),
          xdr.ScVal.scvBytes(Buffer.from(args.txData)),
        );
        // `fee` = puja de inclusión por operación; prepareTransaction suma la resource fee de Soroban.
        const tx = new TransactionBuilder(account, { fee: String(maxInclusionFeeStroops), networkPassphrase: this.passphrase })
          .addOperation(op)
          .setTimeout(this.txTimeoutSec)
          .build();
        prepared = await server.prepareTransaction(tx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Fallo de simulación = error determinista del contrato (p. ej. InvalidBatchIndex).
        if (/Error\(Contract|HostError|simulation/i.test(msg)) throw new L1Error('TX_FAILED', describeContractError(msg));
        throw new L1Error('NETWORK', msg);
      }
      prepared.sign(this.keypair);
      const hash = Buffer.from(prepared.hash()).toString('hex');

      let sent: rpc.Api.SendTransactionResponse;
      try {
        sent = await server.sendTransaction(prepared);
      } catch (e) {
        throw new L1Error('NETWORK', e instanceof Error ? e.message : String(e));
      }
      if (sent.status === 'ERROR') {
        // errorResult es un TransactionResult XDR (p. ej. txBadSeq, txInsufficientFee). Se guarda en base64 para diagnóstico.
        const detail = sent.errorResult ? sent.errorResult.toXDR('base64') : 'desconocido';
        throw new L1Error('TX_FAILED', `sendTransaction ERROR (TransactionResult XDR): ${detail}`);
      }
      if (sent.status === 'TRY_AGAIN_LATER') throw new L1Error('TRY_AGAIN_LATER', 'TRY_AGAIN_LATER: cola llena / surge pricing');
      // PENDING o DUPLICATE → esperar inclusión
      const deadline = Date.now() + this.confirmTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(this.pollIntervalMs);
        let r: rpc.Api.GetTransactionResponse;
        try {
          r = await server.getTransaction(hash);
        } catch {
          continue; // fallo transitorio del RPC: seguimos esperando
        }
        if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { txHash: hash, ledger: r.ledger };
        if (r.status === rpc.Api.GetTransactionStatus.FAILED) {
          throw new L1Error('TX_FAILED', describeContractError(`tx ${hash} FAILED en ledger ${r.ledger}`));
        }
      }
      throw new L1Error('TIMEOUT', `tx ${hash} no se incluyó en ${this.confirmTimeoutMs / 1000}s (fee ${maxInclusionFeeStroops} insuficiente o red lenta)`);
    });
  }

  async fetchDeposits(fromLedger: number, limit: number): Promise<{ deposits: DepositEvent[]; latestLedger: number }> {
    return this.withFailover(async (server) => {
      try {
        const latest = await server.getLatestLedger();
        let start = fromLedger + 1;
        if (fromLedger <= 0) start = Math.max(1, latest.sequence - 17_280); // ~1 día si no hay cursor
        const health = await server.getHealth();
        if (health.oldestLedger && start < health.oldestLedger) start = health.oldestLedger;
        if (start > latest.sequence) return { deposits: [], latestLedger: latest.sequence };

        const res = await server.getEvents({
          startLedger: start,
          filters: [{ type: 'contract', contractIds: [this.bridgeId], topics: [[xdr.ScVal.scvSymbol('deposit').toXDR('base64'), '*']] }],
          limit,
        });
        const deposits: DepositEvent[] = [];
        for (const ev of res.events) {
          const topic1 = ev.topic[1];
          const data = scValToNative(ev.value) as Record<string, unknown>;
          deposits.push({
            index: BigInt(scValToNative(topic1) as bigint),
            from: String(data.from),
            token: String(data.token),
            amount: BigInt(data.amount as bigint),
            l2Recipient: String(data.l2_recipient),
            ledger: ev.ledger,
            l1TxHash: ev.txHash,
          });
        }
        return { deposits, latestLedger: res.latestLedger };
      } catch (e) {
        throw e instanceof L1Error ? e : new L1Error('NETWORK', e instanceof Error ? e.message : String(e));
      }
    });
  }

  /** Construye (sin firmar) la tx L1 para que un usuario deposite en el puente. Útil para SDK/frontend. */
  static buildDepositTx(opts: { server: rpc.Server; networkPassphrase: string; bridgeContractId: string; from: string; token: string; amount: bigint; l2Recipient: string; fee?: string }) {
    return opts.server.getAccount(opts.from).then((account) =>
      new TransactionBuilder(account, { fee: opts.fee ?? '1000', networkPassphrase: opts.networkPassphrase })
        .addOperation(
          new Contract(opts.bridgeContractId).call(
            'deposit',
            new Address(opts.from).toScVal(),
            new Address(opts.token).toScVal(),
            nativeToScVal(opts.amount, { type: 'i128' }),
            new Address(opts.l2Recipient).toScVal(),
          ),
        )
        .setTimeout(60)
        .build(),
    );
  }
}
