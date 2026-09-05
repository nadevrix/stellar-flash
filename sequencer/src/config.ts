/**
 * Configuración del secuenciador (variables de entorno). Ver `.env.example`.
 */
import { Networks } from '@stellar/stellar-sdk';

export type L1Mode = 'mock' | 'rpc';

export interface SequencerConfig {
  /** `mock`: L1 simulada en memoria (demo/tests). `rpc`: Stellar real vía Stellar RPC. */
  l1Mode: L1Mode;
  networkPassphrase: string;
  /** Lista de endpoints Stellar RPC (failover en orden). */
  rpcUrls: string[];
  bridgeContractId: string;
  /** Secreto (S...) de la cuenta secuenciadora que firma `commit_batch`. Solo modo rpc. */
  sequencerSecret?: string;
  /** Tokens habilitados (contract ids). Vacío = cualquiera. */
  allowedTokens: string[];
  dbPath: string;
  apiPort: number;
  apiHost: string;

  // Lotes
  sealIntervalMs: number;
  maxBatchBytes: number;
  maxBatchTxs: number;

  // Settlement / salud L1
  tickMs: number;
  healthProbeTimeoutMs: number;
  /** Edad máx. del último ledger para considerar L1 sana (s). Ledgers cierran cada ~5-6 s. */
  healthyLedgerAgeSec: number;
  /** Edad a partir de la cual L1 se considera caída (s). */
  downLedgerAgeSec: number;
  /** Fee de inclusión p90 (stroops) a partir del cual consideramos surge pricing (DEGRADED). */
  surgeFeeStroops: number;
  /** Fee mínima y máxima que estamos dispuestos a pujar por `commit_batch` (stroops). */
  minInclusionFeeStroops: number;
  maxInclusionFeeStroops: number;
  /** Con L1 DEGRADED, cuánto diferimos un lote sin retiros antes de publicarlo igual (ms). */
  maxDeferMs: number;
  /** Periodo de desafío (ledgers); debe coincidir con el contrato. Se lee del contrato en modo rpc. */
  challengePeriodLedgers: number;
  /** Ledger desde el que empezar a escanear depósitos si no hay estado previo. */
  depositScanStartLedger: number;
}

const env = (k: string, d?: string): string | undefined => process.env[k] ?? d;
const num = (k: string, d: number): number => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`variable ${k} debe ser numérica`);
  return n;
};

export function loadConfig(overrides: Partial<SequencerConfig> = {}): SequencerConfig {
  const l1Mode = (env('L1_MODE', 'mock') as L1Mode) ?? 'mock';
  const cfg: SequencerConfig = {
    l1Mode,
    networkPassphrase: env('NETWORK_PASSPHRASE', Networks.TESTNET)!,
    rpcUrls: (env('RPC_URLS', 'https://soroban-testnet.stellar.org') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    // Placeholder válido para modo mock; en modo rpc debe ser el contrato desplegado.
    bridgeContractId: env('BRIDGE_CONTRACT_ID', 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA')!,
    sequencerSecret: env('SEQUENCER_SECRET'),
    allowedTokens: (env('ALLOWED_TOKENS', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    dbPath: env('DB_PATH', 'data/flash.db')!,
    apiPort: num('API_PORT', 8787),
    apiHost: env('API_HOST', '127.0.0.1')!,
    sealIntervalMs: num('SEAL_INTERVAL_MS', 2_000),
    maxBatchBytes: num('MAX_BATCH_BYTES', 60_000),
    maxBatchTxs: num('MAX_BATCH_TXS', 250),
    tickMs: num('TICK_MS', 1_000),
    healthProbeTimeoutMs: num('HEALTH_PROBE_TIMEOUT_MS', 4_000),
    healthyLedgerAgeSec: num('HEALTHY_LEDGER_AGE_SEC', 15),
    downLedgerAgeSec: num('DOWN_LEDGER_AGE_SEC', 60),
    surgeFeeStroops: num('SURGE_FEE_STROOPS', 2_000),
    minInclusionFeeStroops: num('MIN_INCLUSION_FEE_STROOPS', 200),
    maxInclusionFeeStroops: num('MAX_INCLUSION_FEE_STROOPS', 1_000_000),
    maxDeferMs: num('MAX_DEFER_MS', 60_000),
    challengePeriodLedgers: num('CHALLENGE_PERIOD_LEDGERS', 20),
    depositScanStartLedger: num('DEPOSIT_SCAN_START_LEDGER', 0),
    ...overrides,
  };
  if (cfg.l1Mode === 'rpc' && !cfg.sequencerSecret) throw new Error('SEQUENCER_SECRET es obligatorio en L1_MODE=rpc');
  return cfg;
}
