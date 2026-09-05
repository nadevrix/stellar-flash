//! # Stellar Flash · `flash-bridge`
//!
//! Contrato L1 (Soroban) del rollup de pagos **Stellar Flash**. Cumple el mismo rol que
//! los contratos `Bridge`/`Rollup`/`Outbox` de Arbitrum sobre Ethereum:
//!
//! 1. **Bóveda (vault):** custodia los activos (XLM, USDC, cualquier token Soroban/SAC)
//!    depositados por los usuarios. Un depósito en L1 se convierte en saldo en L2 (FXLM, FUSDC...).
//! 2. **Commitments de estado:** el secuenciador publica por lote (batch) la raíz Merkle del
//!    estado L2, la raíz de retiros y los datos crudos del lote (data availability en L1).
//! 3. **Retiros (outbox):** cualquier usuario puede reclamar un retiro incluido en un lote
//!    finalizado presentando una prueba Merkle. No depende de que el secuenciador coopere.
//! 4. **Escape hatch:** si el secuenciador deja de publicar lotes (muerte/censura), los usuarios
//!    salen con una prueba Merkle de su saldo contra la última raíz finalizada, y los depósitos
//!    no acreditados se pueden recuperar.
//!
//! Modelo de confianza v0: secuenciador único (igual que Arbitrum One en 2021). Las pruebas de
//! fraude (`challenge_batch`) y la inclusión forzada están especificadas en `docs/05-contratos-soroban.md`
//! como fase 2. Ver también `docs/04-arquitectura-tecnica.md`.
//!
//! ## Formato de hojas Merkle (debe coincidir byte a byte con `protocol/src/merkle.ts`)
//! - `leaf_state      = sha256(0x00 || xdr(ScVal(account)) || xdr(ScVal(token)) || balance_i128_be || nonce_u64_be)`
//! - `node            = sha256(0x01 || left || right)`  (hermano faltante = 32 bytes cero)
//! - `leaf_withdrawal = sha256(0x02 || batch_index_u64_be || w_index_u32_be || xdr(ScVal(recipient)) || xdr(ScVal(token)) || amount_i128_be)`
//! - raíz de árbol vacío = 32 bytes cero.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address,
    Bytes, BytesN, Env, Vec,
};

pub const LEAF_STATE_TAG: u8 = 0x00;
pub const NODE_TAG: u8 = 0x01;
pub const LEAF_WITHDRAWAL_TAG: u8 = 0x02;

// TTLs (en ledgers; ~5s por ledger). Instancia: umbral ~15 días, extiende a ~30 días.
const INSTANCE_TTL_THRESHOLD: u32 = 259_200;
const INSTANCE_TTL_EXTEND: u32 = 518_400;
// Entradas persistentes (lotes, depósitos, claims): umbral ~30 días, extiende a ~60 días.
const PERSISTENT_TTL_THRESHOLD: u32 = 518_400;
const PERSISTENT_TTL_EXTEND: u32 = 1_036_800;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    InvalidAmount = 2,
    InvalidBatchIndex = 3,
    StateRootMismatch = 4,
    InvalidDepositCursor = 5,
    BatchNotFound = 6,
    BatchNotFinalized = 7,
    AlreadyClaimed = 8,
    InvalidProof = 9,
    SequencerAlive = 10,
    AlreadyEscaped = 11,
    DepositNotFound = 12,
    DepositAlreadyProcessed = 13,
    InvalidConfig = 14,
    NoBatches = 15,
    EmptyBatch = 16,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Sequencer,
    ChallengePeriod,
    LivenessTimeout,
    Paused,
    BatchCount,
    DepositCount,
    LastCommitLedger,
    /// Lote comprometido, por índice.
    Batch(u64),
    /// Depósito pendiente de acreditar/reclamar, por índice. Se elimina al reclamarlo.
    Deposit(u64),
    /// Retiro ya pagado: (batch_index, w_index).
    Claimed(u64, u32),
    /// Escape ya ejecutado: sha256(batch_index || xdr(account) || xdr(token)).
    Escaped(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchInfo {
    pub state_root: BytesN<32>,
    pub withdrawals_root: BytesN<32>,
    pub tx_data_hash: BytesN<32>,
    pub tx_count: u32,
    /// Depósitos con índice < deposit_cursor ya están acreditados en el estado L2 de este lote.
    pub deposit_cursor: u64,
    pub commit_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DepositInfo {
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    pub l2_recipient: Address,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub sequencer: Address,
    pub challenge_period_ledgers: u32,
    pub liveness_timeout_ledgers: u32,
    pub paused: bool,
    pub batch_count: u64,
    pub deposit_count: u64,
    pub last_commit_ledger: u32,
}

// ---------------------------------------------------------------------------
// Eventos (topic fijo = nombre en snake_case; el secuenciador los indexa por `getEvents`)
// ---------------------------------------------------------------------------

/// topics: ["deposit", index] · data: {from, token, amount, l2_recipient}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposit {
    #[topic]
    pub index: u64,
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    pub l2_recipient: Address,
}

/// topics: ["batch_committed", index] · data: {state_root, withdrawals_root, tx_data_hash, tx_count, deposit_cursor}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCommitted {
    #[topic]
    pub index: u64,
    pub state_root: BytesN<32>,
    pub withdrawals_root: BytesN<32>,
    pub tx_data_hash: BytesN<32>,
    pub tx_count: u32,
    pub deposit_cursor: u64,
}

/// topics: ["withdrawn", batch_index, w_index] · data: {recipient, token, amount}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub batch_index: u64,
    #[topic]
    pub w_index: u32,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
}

/// topics: ["escaped", batch_index] · data: {account, token, balance}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escaped {
    #[topic]
    pub batch_index: u64,
    pub account: Address,
    pub token: Address,
    pub balance: i128,
}

/// topics: ["deposit_reclaimed", index] · data: {from, token, amount}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositReclaimed {
    #[topic]
    pub index: u64,
    pub from: Address,
    pub token: Address,
    pub amount: i128,
}

// ---------------------------------------------------------------------------
// Hashing / Merkle (compartido con el secuenciador TypeScript)
// ---------------------------------------------------------------------------

pub fn zero_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

pub fn hash_node(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut b = Bytes::new(env);
    b.push_back(NODE_TAG);
    b.extend_from_array(&left.to_array());
    b.extend_from_array(&right.to_array());
    env.crypto().sha256(&b).to_bytes()
}

pub fn state_leaf(env: &Env, account: &Address, token: &Address, balance: i128, nonce: u64) -> BytesN<32> {
    let mut b = Bytes::new(env);
    b.push_back(LEAF_STATE_TAG);
    b.append(&account.clone().to_xdr(env));
    b.append(&token.clone().to_xdr(env));
    b.extend_from_array(&balance.to_be_bytes());
    b.extend_from_array(&nonce.to_be_bytes());
    env.crypto().sha256(&b).to_bytes()
}

pub fn withdrawal_leaf(
    env: &Env,
    batch_index: u64,
    w_index: u32,
    recipient: &Address,
    token: &Address,
    amount: i128,
) -> BytesN<32> {
    let mut b = Bytes::new(env);
    b.push_back(LEAF_WITHDRAWAL_TAG);
    b.extend_from_array(&batch_index.to_be_bytes());
    b.extend_from_array(&w_index.to_be_bytes());
    b.append(&recipient.clone().to_xdr(env));
    b.append(&token.clone().to_xdr(env));
    b.extend_from_array(&amount.to_be_bytes());
    env.crypto().sha256(&b).to_bytes()
}

/// Verifica una prueba Merkle binaria. `index` es la posición de la hoja; el bit menos
/// significativo indica si la hoja/nodo actual va a la izquierda (0) o derecha (1) en cada nivel.
pub fn verify_proof(
    env: &Env,
    leaf: &BytesN<32>,
    index: u32,
    proof: &Vec<BytesN<32>>,
    root: &BytesN<32>,
) -> bool {
    let mut node = leaf.clone();
    let mut idx = index;
    for sibling in proof.iter() {
        node = if idx & 1 == 0 {
            hash_node(env, &node, &sibling)
        } else {
            hash_node(env, &sibling, &node)
        };
        idx >>= 1;
    }
    // Si sobran bits de índice, la prueba es más corta que la profundidad implícita → inválida.
    idx == 0 && node == *root
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

fn get_u64(env: &Env, key: DataKey) -> u64 {
    env.storage().instance().get(&key).unwrap_or(0u64)
}

fn get_u32(env: &Env, key: DataKey) -> u32 {
    env.storage().instance().get(&key).unwrap_or(0u32)
}

fn admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn sequencer(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Sequencer).unwrap()
}

fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

fn load_batch(env: &Env, index: u64) -> Result<BatchInfo, Error> {
    let key = DataKey::Batch(index);
    let info: Option<BatchInfo> = env.storage().persistent().get(&key);
    match info {
        Some(b) => {
            bump_persistent(env, &key);
            Ok(b)
        }
        None => Err(Error::BatchNotFound),
    }
}

fn is_finalized(env: &Env, batch: &BatchInfo) -> bool {
    let challenge = get_u32(env, DataKey::ChallengePeriod);
    env.ledger().sequence() >= batch.commit_ledger.saturating_add(challenge)
}

/// El secuenciador se considera "muerto" si no ha publicado un lote en `liveness_timeout` ledgers
/// (contando desde el despliegue si nunca publicó).
fn sequencer_is_dead(env: &Env) -> bool {
    let last = get_u32(env, DataKey::LastCommitLedger);
    let timeout = get_u32(env, DataKey::LivenessTimeout);
    env.ledger().sequence() > last.saturating_add(timeout)
}

fn escape_key(env: &Env, batch_index: u64, account: &Address, token: &Address) -> BytesN<32> {
    let mut b = Bytes::new(env);
    b.extend_from_array(&batch_index.to_be_bytes());
    b.append(&account.clone().to_xdr(env));
    b.append(&token.clone().to_xdr(env));
    env.crypto().sha256(&b).to_bytes()
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

#[contract]
pub struct FlashBridge;

#[contractimpl]
impl FlashBridge {
    /// Constructor (Protocolo 22+). `liveness_timeout_ledgers` debe ser >= `challenge_period_ledgers`
    /// para que, cuando se habilite el escape, el último lote ya esté finalizado.
    pub fn __constructor(
        env: Env,
        admin: Address,
        sequencer: Address,
        challenge_period_ledgers: u32,
        liveness_timeout_ledgers: u32,
    ) {
        if liveness_timeout_ledgers < challenge_period_ledgers {
            panic!("liveness_timeout must be >= challenge_period");
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Sequencer, &sequencer);
        s.set(&DataKey::ChallengePeriod, &challenge_period_ledgers);
        s.set(&DataKey::LivenessTimeout, &liveness_timeout_ledgers);
        s.set(&DataKey::Paused, &false);
        s.set(&DataKey::BatchCount, &0u64);
        s.set(&DataKey::DepositCount, &0u64);
        s.set(&DataKey::LastCommitLedger, &env.ledger().sequence());
        bump_instance(&env);
    }

    // ----------------------------- Depósitos (L1 → L2) -----------------------------

    /// Deposita `amount` de `token` en la bóveda y acredita `l2_recipient` en Flash.
    /// Devuelve el índice del depósito. El secuenciador escucha el evento `deposit` y acredita
    /// el saldo en L2 en el siguiente lote (finalidad L1 = 1 ledger ≈ 5s).
    pub fn deposit(
        env: Env,
        from: Address,
        token: Address,
        amount: i128,
        l2_recipient: Address,
    ) -> Result<u64, Error> {
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();

        token::TokenClient::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let index = get_u64(&env, DataKey::DepositCount);
        let info = DepositInfo {
            from: from.clone(),
            token: token.clone(),
            amount,
            l2_recipient: l2_recipient.clone(),
            ledger: env.ledger().sequence(),
        };
        let key = DataKey::Deposit(index);
        env.storage().persistent().set(&key, &info);
        bump_persistent(&env, &key);
        env.storage().instance().set(&DataKey::DepositCount, &(index + 1));
        bump_instance(&env);

        Deposit { index, from, token, amount, l2_recipient }.publish(&env);
        Ok(index)
    }

    // ----------------------------- Lotes (L2 → L1) -----------------------------

    /// Publica un lote. Solo el secuenciador. Los datos crudos del lote (`tx_data`) viajan en la
    /// transacción L1 (quedan en el historial de Stellar = data availability) y en estado solo se
    /// guarda su hash. Devuelve `sha256(tx_data)`.
    pub fn commit_batch(
        env: Env,
        batch_index: u64,
        prev_state_root: BytesN<32>,
        new_state_root: BytesN<32>,
        withdrawals_root: BytesN<32>,
        tx_count: u32,
        deposit_cursor: u64,
        tx_data: Bytes,
    ) -> Result<BytesN<32>, Error> {
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        sequencer(&env).require_auth();

        let count = get_u64(&env, DataKey::BatchCount);
        if batch_index != count {
            return Err(Error::InvalidBatchIndex);
        }
        if tx_count == 0 {
            return Err(Error::EmptyBatch);
        }

        let (expected_prev_root, prev_cursor) = if count == 0 {
            (zero_root(&env), 0u64)
        } else {
            let prev = load_batch(&env, count - 1)?;
            (prev.state_root, prev.deposit_cursor)
        };
        if prev_state_root != expected_prev_root {
            return Err(Error::StateRootMismatch);
        }
        let deposit_count = get_u64(&env, DataKey::DepositCount);
        if deposit_cursor < prev_cursor || deposit_cursor > deposit_count {
            return Err(Error::InvalidDepositCursor);
        }

        let tx_data_hash = env.crypto().sha256(&tx_data).to_bytes();
        let ledger = env.ledger().sequence();
        let info = BatchInfo {
            state_root: new_state_root.clone(),
            withdrawals_root: withdrawals_root.clone(),
            tx_data_hash: tx_data_hash.clone(),
            tx_count,
            deposit_cursor,
            commit_ledger: ledger,
        };
        let key = DataKey::Batch(batch_index);
        env.storage().persistent().set(&key, &info);
        bump_persistent(&env, &key);
        let s = env.storage().instance();
        s.set(&DataKey::BatchCount, &(batch_index + 1));
        s.set(&DataKey::LastCommitLedger, &ledger);
        bump_instance(&env);

        BatchCommitted {
            index: batch_index,
            state_root: new_state_root,
            withdrawals_root,
            tx_data_hash: tx_data_hash.clone(),
            tx_count,
            deposit_cursor,
        }
        .publish(&env);
        Ok(tx_data_hash)
    }

    // ----------------------------- Retiros (outbox) -----------------------------

    /// Reclama un retiro incluido en el lote `batch_index` (ya finalizado). Cualquiera puede
    /// ejecutarlo; los fondos siempre van a `recipient`.
    pub fn withdraw(
        env: Env,
        batch_index: u64,
        w_index: u32,
        recipient: Address,
        token: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let batch = load_batch(&env, batch_index)?;
        if !is_finalized(&env, &batch) {
            return Err(Error::BatchNotFinalized);
        }
        let claim_key = DataKey::Claimed(batch_index, w_index);
        if env.storage().persistent().has(&claim_key) {
            return Err(Error::AlreadyClaimed);
        }
        let leaf = withdrawal_leaf(&env, batch_index, w_index, &recipient, &token, amount);
        if !verify_proof(&env, &leaf, w_index, &proof, &batch.withdrawals_root) {
            return Err(Error::InvalidProof);
        }
        env.storage().persistent().set(&claim_key, &true);
        bump_persistent(&env, &claim_key);

        token::TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &recipient, &amount);

        Withdrawn { batch_index, w_index, recipient, token, amount }.publish(&env);
        Ok(())
    }

    // ----------------------------- Escape hatch -----------------------------

    /// Salida de emergencia: si el secuenciador lleva más de `liveness_timeout` ledgers sin
    /// publicar, cualquier cuenta puede retirar su saldo L2 probando su hoja contra la raíz de
    /// estado del último lote (que ya está finalizado, porque liveness_timeout >= challenge_period).
    pub fn escape(
        env: Env,
        account: Address,
        token: Address,
        balance: i128,
        nonce: u64,
        leaf_index: u32,
        proof: Vec<BytesN<32>>,
    ) -> Result<(), Error> {
        if !sequencer_is_dead(&env) {
            return Err(Error::SequencerAlive);
        }
        if balance <= 0 {
            return Err(Error::InvalidAmount);
        }
        let count = get_u64(&env, DataKey::BatchCount);
        if count == 0 {
            return Err(Error::NoBatches);
        }
        let last_index = count - 1;
        let batch = load_batch(&env, last_index)?;
        if !is_finalized(&env, &batch) {
            return Err(Error::BatchNotFinalized);
        }
        let ekey = DataKey::Escaped(escape_key(&env, last_index, &account, &token));
        if env.storage().persistent().has(&ekey) {
            return Err(Error::AlreadyEscaped);
        }
        let leaf = state_leaf(&env, &account, &token, balance, nonce);
        if !verify_proof(&env, &leaf, leaf_index, &proof, &batch.state_root) {
            return Err(Error::InvalidProof);
        }
        env.storage().persistent().set(&ekey, &true);
        bump_persistent(&env, &ekey);

        token::TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &account, &balance);

        Escaped { batch_index: last_index, account, token, balance }.publish(&env);
        Ok(())
    }

    /// Devuelve un depósito que el secuenciador nunca acreditó (índice >= deposit_cursor del
    /// último lote) cuando el secuenciador está muerto. Si no hay lotes, todos son reclamables.
    pub fn reclaim_deposit(env: Env, index: u64) -> Result<(), Error> {
        if !sequencer_is_dead(&env) {
            return Err(Error::SequencerAlive);
        }
        let key = DataKey::Deposit(index);
        let info: DepositInfo = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DepositNotFound)?;

        let count = get_u64(&env, DataKey::BatchCount);
        if count > 0 {
            let last = load_batch(&env, count - 1)?;
            if index < last.deposit_cursor {
                // Ya fue acreditado en L2: debe salir vía `escape`, no por aquí.
                return Err(Error::DepositAlreadyProcessed);
            }
        }
        env.storage().persistent().remove(&key);
        token::TokenClient::new(&env, &info.token).transfer(&env.current_contract_address(), &info.from, &info.amount);
        DepositReclaimed { index, from: info.from, token: info.token, amount: info.amount }.publish(&env);
        Ok(())
    }

    // ----------------------------- Admin -----------------------------

    pub fn set_sequencer(env: Env, new_sequencer: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Sequencer, &new_sequencer);
        bump_instance(&env);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
    }

    /// Pausa depósitos, lotes y retiros normales. **No** pausa `escape` ni `reclaim_deposit`:
    /// la salida de emergencia nunca puede quedar bloqueada por el admin.
    pub fn set_paused(env: Env, paused: bool) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
    }

    // ----------------------------- Lecturas -----------------------------

    pub fn get_config(env: Env) -> Config {
        Config {
            admin: admin(&env),
            sequencer: sequencer(&env),
            challenge_period_ledgers: get_u32(&env, DataKey::ChallengePeriod),
            liveness_timeout_ledgers: get_u32(&env, DataKey::LivenessTimeout),
            paused: is_paused(&env),
            batch_count: get_u64(&env, DataKey::BatchCount),
            deposit_count: get_u64(&env, DataKey::DepositCount),
            last_commit_ledger: get_u32(&env, DataKey::LastCommitLedger),
        }
    }

    pub fn get_batch(env: Env, index: u64) -> Result<BatchInfo, Error> {
        load_batch(&env, index)
    }

    pub fn get_deposit(env: Env, index: u64) -> Option<DepositInfo> {
        env.storage().persistent().get(&DataKey::Deposit(index))
    }

    pub fn batch_finalized(env: Env, index: u64) -> Result<bool, Error> {
        let b = load_batch(&env, index)?;
        Ok(is_finalized(&env, &b))
    }

    pub fn is_claimed(env: Env, batch_index: u64, w_index: u32) -> bool {
        env.storage().persistent().has(&DataKey::Claimed(batch_index, w_index))
    }

    /// Raíz de estado actual (del último lote) o la raíz vacía si no hay lotes.
    pub fn current_state_root(env: Env) -> BytesN<32> {
        let count = get_u64(&env, DataKey::BatchCount);
        if count == 0 {
            zero_root(&env)
        } else {
            load_batch(&env, count - 1).map(|b| b.state_root).unwrap_or(zero_root(&env))
        }
    }

    /// Utilidades públicas para que el secuenciador/SDK puedan verificar que su hashing coincide.
    pub fn compute_state_leaf(env: Env, account: Address, token: Address, balance: i128, nonce: u64) -> BytesN<32> {
        state_leaf(&env, &account, &token, balance, nonce)
    }

    pub fn compute_withdrawal_leaf(
        env: Env,
        batch_index: u64,
        w_index: u32,
        recipient: Address,
        token: Address,
        amount: i128,
    ) -> BytesN<32> {
        withdrawal_leaf(&env, batch_index, w_index, &recipient, &token, amount)
    }
}

#[cfg(test)]
mod test;
