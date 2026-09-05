# 09 · Base de datos

## 1. Principio: event sourcing

La tabla `transactions` es el **log ordenado** (`seq` monótono) y la única fuente de verdad del estado L2. El estado en memoria (saldos/nonces) es una **proyección** que se reconstruye desde el último `snapshot` + replay. Ventajas: recuperación trivial, auditoría completa, y el mismo log es lo que se publica en L1 por lotes.

Implementación actual: SQLite vía `node:sqlite` (`sequencer/src/db/store.ts`), WAL, `synchronous=NORMAL`. Sirve para desarrollo, demo y una primera producción pequeña (miles de tx/s en una máquina).

## 2. Esquema (SQLite hoy; tipos Postgres entre paréntesis)

```sql
meta(key TEXT PK, value TEXT)                       -- domain, deposit_scan_ledger, …

transactions(
  seq INTEGER PK (BIGSERIAL),                        -- orden global L2
  id TEXT UNIQUE (CHAR(64)),                         -- sha256(domain || encodeTx)
  type TEXT,                                         -- transfer | withdraw | deposit
  from_account TEXT NULL, to_account TEXT NULL,      -- índices para consultas por cuenta
  token TEXT, amount TEXT (NUMERIC(39,0)),
  json TEXT (JSONB),                                 -- tx completa (con firma) para replay/DA
  batch_index INTEGER NULL (BIGINT),                 -- NULL hasta sellar
  created_at INTEGER (TIMESTAMPTZ), latency_us INTEGER)
  idx: (from_account, seq), (to_account, seq), (batch_index)

batches(
  batch_index INTEGER PK (BIGINT),
  prev_state_root, new_state_root, withdrawals_root, tx_data_hash TEXT (CHAR(64)),
  tx_count INTEGER, deposit_cursor INTEGER (BIGINT),
  tx_data BLOB (BYTEA),                              -- lo publicado en L1
  first_seq, last_seq INTEGER,
  status TEXT,                                       -- sealed | committed | finalized
  l1_tx_hash TEXT NULL, commit_ledger INTEGER NULL,
  sealed_at, committed_at NULL, finalized_at NULL (TIMESTAMPTZ),
  attempts INTEGER, last_attempt_at NULL, last_error TEXT NULL)

withdrawals(tx_id TEXT PK, batch_index, w_index INTEGER, recipient, token, amount TEXT,
            UNIQUE(batch_index, w_index))          -- añadir en prod: claimed_l1_tx_hash, claimed_at

deposits(deposit_index INTEGER PK, from_account, token, amount TEXT, l2_recipient, ledger INTEGER,
         l1_tx_hash TEXT, tx_id TEXT)

snapshots(id=1, last_seq INTEGER, state_root TEXT, json TEXT (JSONB), saved_at)

health_log(id PK, at, status, latest_ledger, ledger_age_sec, fee_p50, fee_p90, ok_endpoints, total_endpoints, reason)
```

## 3. Invariantes que el código mantiene
- `transactions.seq` sin huecos; `batches.first_seq..last_seq` cubre exactamente las txs con ese `batch_index`.
- `batches[i].prev_state_root == batches[i-1].new_state_root`; `batches[0].prev_state_root == 0x00…`.
- `withdrawals` de un lote reconstruyen `withdrawals_root` (se verifica al generar pruebas).
- `Σ saldos L2 (por token) + Σ retiros no reclamados == balance del contrato en L1` (verificable externamente; añadir job de reconciliación).
- Una tx se persiste **antes** de mutar el estado; si la escritura falla, la tx se rechaza.

## 4. Migración a PostgreSQL (producción)

Cuándo: al pasar de un proceso a alta disponibilidad (réplica en caliente), o cuando el log supere lo cómodo para un archivo (decenas de GB).

Cómo:
1. Implementar `PgStore` con la misma interfaz que `Store` (misma firma de métodos; ~300 líneas con `pg`). Elegir por `DB_URL` (`postgres://…` → Pg, ruta → SQLite).
2. Tipos: `amount`/`deposit_cursor` como `NUMERIC(39,0)`/`BIGINT`; `json` como `JSONB`; `tx_data` como `BYTEA`; timestamps `TIMESTAMPTZ`.
3. Transacción por `submit` (insert tx [+ deposit]) — en Pg usar `BEGIN…COMMIT` o un `INSERT` único; latencia de red a la DB pasa a dominar (~0.3–1 ms): usar pool y, si hace falta, micro-lotes de escritura.
4. Réplica: streaming replication; el secuenciador pasivo reconstruye el estado leyendo el log y toma el relevo (mismo `SEQUENCER_SECRET` o `set_sequencer`).
5. Retención: `health_log` particionada por día; `transactions` nunca se borra (es la DA local), pero se puede archivar a objeto frío tras finalizar el lote (los datos ya están en L1).

## 5. Índices/consultas del frontend
- Cuenta: `WHERE from_account = $1 OR to_account = $1 ORDER BY seq DESC LIMIT 50` (dos índices; en Pg considerar tabla `account_tx(account, seq)` desnormalizada).
- Explorer: `batches ORDER BY batch_index DESC`, `transactions WHERE batch_index = $1 ORDER BY seq`.
- Health: `health_log ORDER BY id DESC LIMIT 100`.

## 6. Backups y seguridad
- SQLite: `sqlite3 data/flash.db ".backup data/backup-$(date +%s).db"` cada minuto (o Litestream a S3).
- Pg: `pg_basebackup` + WAL archiving.
- La DB no contiene secretos (las firmas son públicas por diseño). El único secreto es `SEQUENCER_SECRET` (fuera de la DB).
