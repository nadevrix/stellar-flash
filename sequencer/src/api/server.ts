/**
 * API HTTP del secuenciador (JSON). Sin framework: `node:http` es suficiente y sin dependencias.
 * Especificación completa y ejemplos en `docs/06-sequencer-backend.md`.
 *
 *  GET  /v1/health                         estado L2 + salud L1 + última decisión de settlement
 *  GET  /v1/accounts/:address              saldos/nonces por token + últimas txs
 *  GET  /v1/accounts/:address/nonce?token= nonce actual para firmar la próxima tx
 *  POST /v1/transactions                   { tx: <json firmado> } → recibo instantáneo
 *  GET  /v1/transactions/:id
 *  GET  /v1/batches?limit=&offset=
 *  GET  /v1/batches/:index                 (+ ?data=1 devuelve tx_data en base64)
 *  GET  /v1/withdrawals/:txId/proof        prueba Merkle para `withdraw` en el puente
 *  GET  /v1/proofs/balance?account=&token= prueba Merkle de saldo (escape hatch)
 *  GET  /v1/deposits
 *  GET  /v1/l1/history                     historial de salud L1
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { FlashError, isValidL2Address, toHex, txFromJson, type SignedTx } from '../../../protocol/src/index.ts';
import type { Sequencer } from '../core/sequencer.ts';
import type { SettlementEngine } from '../settlement/engine.ts';
import type { BatchRecord } from '../db/store.ts';

export interface ApiContext {
  sequencer: Sequencer;
  engine: SettlementEngine;
  info: { networkPassphrase: string; bridgeContractId: string; l1Mode: string; allowedTokens: string[]; startedAt: number };
}

class HttpError extends Error {
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

const json = (res: ServerResponse, status: number, body: unknown) => {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? toHex(v) : v));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
  res.end(s);
};

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'cuerpo demasiado grande');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'JSON inválido');
  }
}

function batchView(b: BatchRecord, withData = false) {
  return {
    index: b.index.toString(),
    status: b.status,
    prevStateRoot: b.prevStateRoot,
    newStateRoot: b.newStateRoot,
    withdrawalsRoot: b.withdrawalsRoot,
    txCount: b.txCount,
    depositCursor: b.depositCursor.toString(),
    txDataHash: b.txDataHash,
    txDataBytes: b.txData.length,
    txData: withData ? Buffer.from(b.txData).toString('base64') : undefined,
    firstSeq: b.firstSeq,
    lastSeq: b.lastSeq,
    l1TxHash: b.l1TxHash,
    commitLedger: b.commitLedger,
    sealedAt: b.sealedAt,
    committedAt: b.committedAt,
    finalizedAt: b.finalizedAt,
    attempts: b.attempts,
    lastError: b.lastError,
  };
}

export function createApiServer(ctx: ApiContext): Server {
  const { sequencer, engine, info } = ctx;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (parts[0] !== 'v1') throw new HttpError(404, 'NOT_FOUND', 'ruta no encontrada');
    const [, resource, id, sub] = parts;

    if (req.method === 'GET' && resource === 'health' && !id) {
      const h = engine.monitor.current();
      const last = sequencer.store.lastBatch();
      return json(res, 200, {
        status: 'ok',
        l2: {
          seq: sequencer.currentSeq,
          pendingTxs: sequencer.pendingCount,
          pendingBytes: sequencer.pendingByteSize,
          nextBatch: sequencer.nextBatch.toString(),
          stateRoot: sequencer.state.rootHex(),
          accounts: sequencer.state.size,
          depositCursor: sequencer.state.nextDepositIndex.toString(),
          lastBatch: last ? batchView(last) : null,
          uptimeSec: Math.round((Date.now() - info.startedAt) / 1000),
        },
        l1: { status: h.status, reason: h.reason, latestLedger: h.latestLedger, ledgerAgeSec: h.ledgerAgeSec, feeP50: h.feeP50, feeP90: h.feeP90, surge: h.surge, endpoints: h.probes.map((p) => ({ endpoint: p.endpoint, ok: p.ok, latencyMs: p.latencyMs, latestLedger: p.latestLedger, error: p.error })) },
        settlement: engine.lastPolicyDecision,
        network: { passphrase: info.networkPassphrase, bridgeContractId: info.bridgeContractId, l1Mode: info.l1Mode, allowedTokens: info.allowedTokens },
      });
    }

    if (resource === 'accounts' && id) {
      if (!isValidL2Address(id)) throw new HttpError(400, 'INVALID_ADDRESS', 'dirección inválida');
      if (req.method === 'GET' && sub === 'nonce') {
        const token = url.searchParams.get('token');
        if (!token || !isValidL2Address(token)) throw new HttpError(400, 'INVALID_TOKEN', 'parámetro token requerido');
        return json(res, 200, { account: id, token, nonce: sequencer.state.get(id, token).nonce.toString() });
      }
      if (req.method === 'GET' && !sub) {
        const balances = sequencer.state.leaves().filter((l) => l.account === id).map((l) => ({ token: l.token, balance: l.balance.toString(), nonce: l.nonce.toString() }));
        const txs = sequencer.store.txsForAccount(id, Number(url.searchParams.get('limit') ?? 25)).map((t) => ({ id: t.id, seq: t.seq, type: t.type, from: t.from, to: t.to, token: t.token, amount: t.amount, batchIndex: t.batchIndex, createdAt: t.createdAt }));
        return json(res, 200, { account: id, balances, transactions: txs });
      }
    }

    if (resource === 'transactions') {
      if (req.method === 'POST' && !id) {
        const body = await readJson(req);
        const raw = (body.tx ?? body) as Record<string, unknown>;
        let tx;
        try {
          tx = txFromJson(raw);
        } catch (e) {
          throw new HttpError(400, 'BAD_TX', e instanceof Error ? e.message : 'tx inválida');
        }
        if (tx.type === 'deposit') throw new HttpError(400, 'BAD_TX', 'los depósitos se acreditan desde L1, no por API');
        try {
          const receipt = sequencer.submit(tx as SignedTx);
          return json(res, 201, { receipt });
        } catch (e) {
          if (e instanceof FlashError) throw new HttpError(422, e.code, e.message, e.details);
          throw e;
        }
      }
      if (req.method === 'GET' && id) {
        const t = sequencer.store.getTx(id);
        if (!t) throw new HttpError(404, 'TX_NOT_FOUND', 'transacción no encontrada');
        const batch = t.batchIndex === null ? null : sequencer.store.getBatch(t.batchIndex);
        return json(res, 200, {
          id: t.id, seq: t.seq, type: t.type, tx: JSON.parse(t.json), createdAt: t.createdAt, latencyUs: t.latencyUs,
          finality: { l2: 'confirmed', l1: batch ? batch.status : 'pending' },
          batch: batch ? batchView(batch) : null,
        });
      }
    }

    if (req.method === 'GET' && resource === 'batches') {
      if (!id) {
        const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return json(res, 200, { batches: sequencer.store.listBatches(limit, offset).map((b) => batchView(b)) });
      }
      if (!/^\d+$/.test(id)) throw new HttpError(400, 'BAD_INDEX', 'índice inválido');
      const b = sequencer.store.getBatch(BigInt(id));
      if (!b) throw new HttpError(404, 'BATCH_NOT_FOUND', 'lote no encontrado');
      return json(res, 200, { batch: batchView(b, url.searchParams.get('data') === '1'), withdrawals: sequencer.store.withdrawalsForBatch(b.index) });
    }

    if (req.method === 'GET' && resource === 'withdrawals' && id && sub === 'proof') {
      const p = sequencer.withdrawalProof(id);
      if (!p) throw new HttpError(404, 'WITHDRAWAL_NOT_FOUND', 'retiro no encontrado o aún no incluido en un lote');
      return json(res, 200, p);
    }

    if (req.method === 'GET' && resource === 'proofs' && id === 'balance') {
      const account = url.searchParams.get('account');
      const token = url.searchParams.get('token');
      if (!account || !token || !isValidL2Address(account) || !isValidL2Address(token)) throw new HttpError(400, 'BAD_PARAMS', 'account y token requeridos');
      try {
        const p = sequencer.balanceProof(account, token);
        return json(res, 200, { ...p, proof: p.proof.map(toHex), root: toHex(p.root), note: 'válida contra la raíz del estado actual; para escape usa la raíz del último lote finalizado' });
      } catch (e) {
        throw new HttpError(404, 'ACCOUNT_NOT_FOUND', e instanceof Error ? e.message : 'cuenta no encontrada');
      }
    }

    if (req.method === 'GET' && resource === 'deposits' && !id) {
      return json(res, 200, { deposits: sequencer.store.listDeposits(Number(url.searchParams.get('limit') ?? 50)) });
    }

    if (req.method === 'GET' && resource === 'l1' && id === 'history') {
      return json(res, 200, { history: sequencer.store.recentHealth(Number(url.searchParams.get('limit') ?? 100)), recent: engine.monitor.history.slice(-50).map((h) => ({ at: h.at, status: h.status, latestLedger: h.latestLedger, ledgerAgeSec: h.ledgerAgeSec, feeP90: h.feeP90 })) });
    }

    throw new HttpError(404, 'NOT_FOUND', 'ruta no encontrada');
  };

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof HttpError) return json(res, e.status, { error: { code: e.code, message: e.message, details: e.details } });
      console.error('[api] error interno', e);
      return json(res, 500, { error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'error interno' } });
    });
  });
}
