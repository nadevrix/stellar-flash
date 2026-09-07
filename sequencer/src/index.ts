/**
 * Punto de entrada del secuenciador Stellar Flash.
 *   node sequencer/src/index.ts            (L1_MODE=mock por defecto: demo local sin red)
 *   L1_MODE=rpc SEQUENCER_SECRET=S... BRIDGE_CONTRACT_ID=C... node sequencer/src/index.ts
 */
import { Keypair } from '@stellar/stellar-sdk';
import { domainSeparator } from '../../protocol/src/index.ts';
import { createApiServer } from './api/server.ts';
import { loadConfig } from './config.ts';
import { Sequencer } from './core/sequencer.ts';
import { Store } from './db/store.ts';
import { SettlementEngine, type EngineEvent } from './settlement/engine.ts';
import { L1HealthMonitor } from './settlement/health.ts';
import { MockL1Client, type L1Client } from './settlement/l1.ts';
import { StellarRpcL1Client } from './settlement/rpc-client.ts';

const cfg = loadConfig();
const domain = domainSeparator({ networkPassphrase: cfg.networkPassphrase, bridgeContractId: cfg.bridgeContractId });
const store = new Store(cfg.dbPath);

// Protege contra arrancar una DB de otra red/puente (las firmas no serían válidas).
const domainHex = Buffer.from(domain).toString('hex');
const storedDomain = store.getMeta('domain');
if (storedDomain && storedDomain !== domainHex) throw new Error(`la base de datos ${cfg.dbPath} pertenece a otro dominio (red/puente). Usa otra DB_PATH.`);
store.setMeta('domain', domainHex);

const sequencer = Sequencer.open({ domain, store, allowedTokens: cfg.allowedTokens.length ? new Set(cfg.allowedTokens) : undefined, maxBatchBytes: cfg.maxBatchBytes, maxBatchTxs: cfg.maxBatchTxs });

let l1: L1Client;
if (cfg.l1Mode === 'rpc') {
  l1 = new StellarRpcL1Client({ rpcUrls: cfg.rpcUrls, networkPassphrase: cfg.networkPassphrase, bridgeContractId: cfg.bridgeContractId, sequencerKeypair: Keypair.fromSecret(cfg.sequencerSecret!) });
} else {
  const mock = new MockL1Client({ challengePeriodLedgers: cfg.challengePeriodLedgers });
  setInterval(() => mock.advanceLedgers(1), 5_000); // ledgers simulados cada 5 s
  l1 = mock;
}

const monitor = new L1HealthMonitor(l1, { healthyLedgerAgeSec: cfg.healthyLedgerAgeSec, downLedgerAgeSec: cfg.downLedgerAgeSec, surgeFeeStroops: cfg.surgeFeeStroops }, cfg.healthProbeTimeoutMs);
const log = (ev: EngineEvent) => console.log(`${new Date(ev.at).toISOString()} [${ev.kind}] ${ev.message}`);
const engine = new SettlementEngine(sequencer, l1, monitor, {
  sealIntervalMs: cfg.sealIntervalMs,
  challengePeriodLedgers: cfg.challengePeriodLedgers,
  depositScanStartLedger: cfg.depositScanStartLedger,
  minInclusionFeeStroops: cfg.minInclusionFeeStroops,
  maxInclusionFeeStroops: cfg.maxInclusionFeeStroops,
  maxDeferMs: cfg.maxDeferMs,
}, log);

// En modo rpc, sincroniza el periodo de desafío y el índice de lote con el contrato.
// Nunca bloquea el arranque: si Stellar está caída, Flash tiene que levantar igual y seguir
// confirmando pagos (es literalmente la tesis del producto). Se reintenta en segundo plano.
if (cfg.l1Mode === 'rpc') {
  const syncBridgeState = async (): Promise<boolean> => {
    try {
      const st = await l1.getBridgeState();
      if (st.batchCount !== sequencer.nextBatch) {
        console.warn(`[startup] contract has ${st.batchCount} batches, local DB has ${sequencer.nextBatch}. See docs/06-sequencer-api.md#recovery`);
      }
      console.log(`[arranque] puente ${cfg.bridgeContractId}: ${st.batchCount} lotes, ${st.depositCount} depósitos, raíz ${st.stateRoot.slice(0, 16)}…, challenge=${st.challengePeriodLedgers} ledgers`);
      return true;
    } catch (err) {
      console.warn(`[arranque] no se pudo leer el contrato (${(err as Error).message}). Flash arranca igual: los pagos L2 siguen confirmando y los lotes esperan a que la L1 vuelva.`);
      return false;
    }
  };
  if (!(await syncBridgeState())) {
    const retry = setInterval(() => { void syncBridgeState().then((ok) => { if (ok) clearInterval(retry); }); }, 30_000);
    retry.unref();
  }
}

engine.start(cfg.tickMs);
const server = createApiServer({ sequencer, engine, info: { networkPassphrase: cfg.networkPassphrase, bridgeContractId: cfg.bridgeContractId, l1Mode: cfg.l1Mode, allowedTokens: cfg.allowedTokens, startedAt: Date.now() } });
server.listen(cfg.apiPort, cfg.apiHost, () => {
  console.log(`Stellar Flash sequencer · L1=${cfg.l1Mode} · API http://${cfg.apiHost}:${cfg.apiPort}/v1/health · DB ${cfg.dbPath}`);
  console.log(`estado: seq=${sequencer.currentSeq} cuentas=${sequencer.state.size} próximo lote=#${sequencer.nextBatch} raíz=${sequencer.state.rootHex().slice(0, 16)}…`);
});

const shutdown = () => {
  console.log('apagando…');
  engine.stop();
  server.close();
  sequencer.saveSnapshot();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
