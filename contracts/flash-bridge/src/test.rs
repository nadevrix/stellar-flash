#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Vec,
};

const CHALLENGE: u32 = 10;
const LIVENESS: u32 = 50;

struct Setup {
    env: Env,
    admin: Address,
    sequencer: Address,
    token: Address,
    bridge: Address,
    client: FlashBridgeClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sequencer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let bridge = env.register(FlashBridge, (admin.clone(), sequencer.clone(), CHALLENGE, LIVENESS));
    let client = FlashBridgeClient::new(&env, &bridge);
    Setup { env, admin, sequencer, token, bridge, client }
}

fn mint(s: &Setup, to: &Address, amount: i128) {
    StellarAssetClient::new(&s.env, &s.token).mint(to, &amount);
}

fn balance(s: &Setup, who: &Address) -> i128 {
    TokenClient::new(&s.env, &s.token).balance(who)
}

fn advance(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|l| l.sequence_number += ledgers);
}

fn bytes32(env: &Env, fill: u8) -> BytesN<32> {
    BytesN::from_array(env, &[fill; 32])
}

/// Construye un árbol Merkle (misma regla que el contrato y `protocol/src/merkle.ts`)
/// y devuelve (raíz, pruebas por hoja).
fn build_tree(env: &Env, leaves: &[BytesN<32>]) -> (BytesN<32>, std::vec::Vec<Vec<BytesN<32>>>) {
    if leaves.is_empty() {
        return (zero_root(env), std::vec::Vec::new());
    }
    let mut proofs: std::vec::Vec<Vec<BytesN<32>>> = (0..leaves.len()).map(|_| Vec::new(env)).collect();
    let mut level: std::vec::Vec<BytesN<32>> = leaves.to_vec();
    let mut positions: std::vec::Vec<usize> = (0..leaves.len()).collect();
    while level.len() > 1 {
        for (leaf_i, pos) in positions.iter_mut().enumerate() {
            let sib = *pos ^ 1;
            let sibling = if sib < level.len() { level[sib].clone() } else { zero_root(env) };
            proofs[leaf_i].push_back(sibling);
            *pos >>= 1;
        }
        let mut next = std::vec::Vec::new();
        let mut i = 0;
        while i < level.len() {
            let left = level[i].clone();
            let right = if i + 1 < level.len() { level[i + 1].clone() } else { zero_root(env) };
            next.push(hash_node(env, &left, &right));
            i += 2;
        }
        level = next;
    }
    (level[0].clone(), proofs)
}

#[test]
fn constructor_sets_config() {
    let s = setup();
    let cfg = s.client.get_config();
    assert_eq!(cfg.admin, s.admin);
    assert_eq!(cfg.sequencer, s.sequencer);
    assert_eq!(cfg.challenge_period_ledgers, CHALLENGE);
    assert_eq!(cfg.liveness_timeout_ledgers, LIVENESS);
    assert!(!cfg.paused);
    assert_eq!(cfg.batch_count, 0);
    assert_eq!(cfg.deposit_count, 0);
    assert_eq!(s.client.current_state_root(), zero_root(&s.env));
}

#[test]
#[should_panic(expected = "liveness_timeout must be >= challenge_period")]
fn constructor_rejects_bad_config() {
    let env = Env::default();
    let a = Address::generate(&env);
    env.register(FlashBridge, (a.clone(), a.clone(), 100u32, 10u32));
}

#[test]
fn deposit_moves_funds_and_indexes() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let l2 = Address::generate(&s.env);
    mint(&s, &alice, 1_000);

    let idx0 = s.client.deposit(&alice, &s.token, &400, &l2);
    let idx1 = s.client.deposit(&alice, &s.token, &100, &alice);
    assert_eq!((idx0, idx1), (0, 1));
    assert_eq!(balance(&s, &alice), 500);
    assert_eq!(balance(&s, &s.bridge), 500);
    assert_eq!(s.client.get_config().deposit_count, 2);

    let d = s.client.get_deposit(&0).unwrap();
    assert_eq!(d.amount, 400);
    assert_eq!(d.l2_recipient, l2);

    assert_eq!(s.client.try_deposit(&alice, &s.token, &0, &l2), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn commit_batch_enforces_sequence_and_roots() {
    let s = setup();
    let alice = Address::generate(&s.env);
    mint(&s, &alice, 1_000);
    s.client.deposit(&alice, &s.token, &1_000, &alice);

    let zero = zero_root(&s.env);
    let r1 = bytes32(&s.env, 1);
    let data = Bytes::from_array(&s.env, &[1u8, 2, 3, 4]);

    // índice incorrecto
    assert_eq!(
        s.client.try_commit_batch(&1, &zero, &r1, &zero, &1, &1, &data),
        Err(Ok(Error::InvalidBatchIndex))
    );
    // prev root incorrecto
    assert_eq!(
        s.client.try_commit_batch(&0, &r1, &r1, &zero, &1, &1, &data),
        Err(Ok(Error::StateRootMismatch))
    );
    // cursor de depósitos por encima de los depósitos existentes
    assert_eq!(
        s.client.try_commit_batch(&0, &zero, &r1, &zero, &1, &2, &data),
        Err(Ok(Error::InvalidDepositCursor))
    );
    // lote vacío
    assert_eq!(
        s.client.try_commit_batch(&0, &zero, &r1, &zero, &0, &1, &data),
        Err(Ok(Error::EmptyBatch))
    );

    let h = s.client.commit_batch(&0, &zero, &r1, &zero, &1, &1, &data);
    assert_eq!(h, s.env.crypto().sha256(&data).to_bytes());
    let b = s.client.get_batch(&0);
    assert_eq!(b.state_root, r1);
    assert_eq!(b.deposit_cursor, 1);
    assert_eq!(s.client.current_state_root(), r1);
    assert_eq!(s.client.get_config().batch_count, 1);

    // el cursor no puede retroceder
    let r2 = bytes32(&s.env, 2);
    assert_eq!(
        s.client.try_commit_batch(&1, &r1, &r2, &zero, &1, &0, &data),
        Err(Ok(Error::InvalidDepositCursor))
    );
    s.client.commit_batch(&1, &r1, &r2, &zero, &3, &1, &data);
    assert_eq!(s.client.current_state_root(), r2);

    // finalización tras el periodo de desafío
    assert!(!s.client.batch_finalized(&1));
    advance(&s.env, CHALLENGE);
    assert!(s.client.batch_finalized(&1));
}

#[test]
fn withdraw_with_merkle_proof() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    let carol = Address::generate(&s.env);
    mint(&s, &alice, 1_000);
    s.client.deposit(&alice, &s.token, &1_000, &alice);

    // Lote 0 con 3 retiros: bob 300, carol 200, alice 100
    let leaves = [
        withdrawal_leaf(&s.env, 0, 0, &bob, &s.token, 300),
        withdrawal_leaf(&s.env, 0, 1, &carol, &s.token, 200),
        withdrawal_leaf(&s.env, 0, 2, &alice, &s.token, 100),
    ];
    let (wroot, proofs) = build_tree(&s.env, &leaves);
    let zero = zero_root(&s.env);
    let data = Bytes::from_array(&s.env, &[9u8; 64]);
    s.client.commit_batch(&0, &zero, &bytes32(&s.env, 7), &wroot, &3, &1, &data);

    // Aún no finalizado
    assert_eq!(
        s.client.try_withdraw(&0, &0, &bob, &s.token, &300, &proofs[0]),
        Err(Ok(Error::BatchNotFinalized))
    );
    advance(&s.env, CHALLENGE);

    // Prueba inválida (monto alterado)
    assert_eq!(
        s.client.try_withdraw(&0, &0, &bob, &s.token, &301, &proofs[0]),
        Err(Ok(Error::InvalidProof))
    );
    // Índice equivocado con prueba de otra hoja
    assert_eq!(
        s.client.try_withdraw(&0, &1, &bob, &s.token, &300, &proofs[0]),
        Err(Ok(Error::InvalidProof))
    );

    s.client.withdraw(&0, &0, &bob, &s.token, &300, &proofs[0]);
    s.client.withdraw(&0, &2, &alice, &s.token, &100, &proofs[2]);
    assert_eq!(balance(&s, &bob), 300);
    assert_eq!(balance(&s, &alice), 100);
    assert_eq!(balance(&s, &s.bridge), 600);
    assert!(s.client.is_claimed(&0, &0));
    assert!(!s.client.is_claimed(&0, &1));

    // Doble reclamo
    assert_eq!(
        s.client.try_withdraw(&0, &0, &bob, &s.token, &300, &proofs[0]),
        Err(Ok(Error::AlreadyClaimed))
    );
    // Lote inexistente
    assert_eq!(
        s.client.try_withdraw(&5, &0, &bob, &s.token, &300, &proofs[0]),
        Err(Ok(Error::BatchNotFound))
    );
}

#[test]
fn single_leaf_tree_root_is_leaf() {
    let s = setup();
    let bob = Address::generate(&s.env);
    let leaf = withdrawal_leaf(&s.env, 0, 0, &bob, &s.token, 5);
    let (root, proofs) = build_tree(&s.env, &[leaf.clone()]);
    assert_eq!(root, leaf);
    assert!(verify_proof(&s.env, &leaf, 0, &proofs[0], &root));
    assert!(!verify_proof(&s.env, &leaf, 1, &proofs[0], &root));
}

#[test]
fn escape_hatch_when_sequencer_dies() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    mint(&s, &alice, 1_000);
    s.client.deposit(&alice, &s.token, &1_000, &alice);

    // Estado L2 tras el lote 0: alice 700 (nonce 1), bob 300 (nonce 0)
    let leaves = [
        state_leaf(&s.env, &alice, &s.token, 700, 1),
        state_leaf(&s.env, &bob, &s.token, 300, 0),
    ];
    let (sroot, proofs) = build_tree(&s.env, &leaves);
    let zero = zero_root(&s.env);
    let data = Bytes::from_array(&s.env, &[1u8; 8]);
    s.client.commit_batch(&0, &zero, &sroot, &zero, &1, &1, &data);

    // Secuenciador vivo → no se puede escapar
    assert_eq!(
        s.client.try_escape(&bob, &s.token, &300, &0, &1, &proofs[1]),
        Err(Ok(Error::SequencerAlive))
    );

    advance(&s.env, LIVENESS + 1);

    // Prueba con saldo alterado
    assert_eq!(
        s.client.try_escape(&bob, &s.token, &301, &0, &1, &proofs[1]),
        Err(Ok(Error::InvalidProof))
    );
    s.client.escape(&bob, &s.token, &300, &0, &1, &proofs[1]);
    assert_eq!(balance(&s, &bob), 300);
    assert_eq!(
        s.client.try_escape(&bob, &s.token, &300, &0, &1, &proofs[1]),
        Err(Ok(Error::AlreadyEscaped))
    );
    s.client.escape(&alice, &s.token, &700, &1, &0, &proofs[0]);
    assert_eq!(balance(&s, &alice), 700);
    assert_eq!(balance(&s, &s.bridge), 0);

    // El escape funciona incluso con el contrato pausado
    s.client.set_paused(&true);
    assert_eq!(
        s.client.try_escape(&alice, &s.token, &700, &1, &0, &proofs[0]),
        Err(Ok(Error::AlreadyEscaped))
    );
}

#[test]
fn reclaim_unprocessed_deposit_when_sequencer_dies() {
    let s = setup();
    let alice = Address::generate(&s.env);
    mint(&s, &alice, 1_000);
    s.client.deposit(&alice, &s.token, &600, &alice); // idx 0 → acreditado en lote 0
    s.client.deposit(&alice, &s.token, &400, &alice); // idx 1 → nunca acreditado

    let zero = zero_root(&s.env);
    let data = Bytes::from_array(&s.env, &[1u8; 8]);
    s.client.commit_batch(&0, &zero, &bytes32(&s.env, 3), &zero, &1, &1, &data);

    assert_eq!(s.client.try_reclaim_deposit(&1), Err(Ok(Error::SequencerAlive)));
    advance(&s.env, LIVENESS + 1);

    assert_eq!(s.client.try_reclaim_deposit(&0), Err(Ok(Error::DepositAlreadyProcessed)));
    assert_eq!(s.client.try_reclaim_deposit(&7), Err(Ok(Error::DepositNotFound)));
    s.client.reclaim_deposit(&1);
    assert_eq!(balance(&s, &alice), 400);
    assert_eq!(s.client.try_reclaim_deposit(&1), Err(Ok(Error::DepositNotFound)));
}

#[test]
fn pause_blocks_normal_operations() {
    let s = setup();
    let alice = Address::generate(&s.env);
    mint(&s, &alice, 100);
    s.client.set_paused(&true);
    assert_eq!(s.client.try_deposit(&alice, &s.token, &100, &alice), Err(Ok(Error::Paused)));
    let zero = zero_root(&s.env);
    let data = Bytes::from_array(&s.env, &[1u8; 8]);
    assert_eq!(
        s.client.try_commit_batch(&0, &zero, &bytes32(&s.env, 1), &zero, &1, &0, &data),
        Err(Ok(Error::Paused))
    );
    s.client.set_paused(&false);
    s.client.deposit(&alice, &s.token, &100, &alice);
}

#[test]
fn admin_rotation() {
    let s = setup();
    let new_seq = Address::generate(&s.env);
    let new_admin = Address::generate(&s.env);
    s.client.set_sequencer(&new_seq);
    s.client.set_admin(&new_admin);
    let cfg = s.client.get_config();
    assert_eq!(cfg.sequencer, new_seq);
    assert_eq!(cfg.admin, new_admin);
}

/// Imprime vectores de prueba para verificar que la implementación TypeScript
/// (`protocol/src/merkle.ts`) produce exactamente los mismos hashes.
/// Ejecutar: `cargo test print_vectors -- --nocapture`
#[test]
fn print_vectors() {
    let env = Env::default();
    // Direcciones reales (válidas): cuenta "cero" bien conocida, una cuenta de la docs de Stellar,
    // y el SAC de XLM nativo en testnet.
    let g_alice = Address::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    let g_bob = Address::from_str(&env, "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ");
    let c_tok = Address::from_str(&env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    let l1 = state_leaf(&env, &g_alice, &c_tok, 1_000_000_000, 0);
    let l2 = state_leaf(&env, &g_bob, &c_tok, 42, 7);
    let l3 = withdrawal_leaf(&env, 3, 1, &g_bob, &c_tok, 12_345);
    let (root, proofs) = build_tree(&env, &[l1.clone(), l2.clone(), l3.clone()]);
    std::println!("VECTOR state_leaf_alice={}", hex(&l1));
    std::println!("VECTOR state_leaf_bob={}", hex(&l2));
    std::println!("VECTOR withdrawal_leaf={}", hex(&l3));
    std::println!("VECTOR root3={}", hex(&root));
    std::println!("VECTOR proof_of_leaf1_len={}", proofs[1].len());
    for p in proofs[1].iter() {
        std::println!("VECTOR proof_of_leaf1_sibling={}", hex(&p));
    }
    assert!(verify_proof(&env, &l2, 1, &proofs[1], &root));
}

fn hex(b: &BytesN<32>) -> std::string::String {
    let mut s = std::string::String::new();
    for byte in b.to_array() {
        s.push_str(&std::format!("{:02x}", byte));
    }
    s
}
