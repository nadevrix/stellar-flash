/**
 * Genera los vectores de prueba cruzados Rust ↔ TypeScript. Debe imprimir exactamente lo mismo que
 * `cargo test print_vectors -- --nocapture` en `contracts/`.
 * Uso: `node scripts/gen-vectors.ts`
 */
import { buildTree, getProof, stateLeaf, toHex, verifyProof, withdrawalLeaf } from '../protocol/src/index.ts';

const G_ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const G_BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const C_TOK = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const l1 = stateLeaf(G_ALICE, C_TOK, 1_000_000_000n, 0n);
const l2 = stateLeaf(G_BOB, C_TOK, 42n, 7n);
const l3 = withdrawalLeaf(3n, 1, G_BOB, C_TOK, 12_345n);
const tree = buildTree([l1, l2, l3]);
const proof = getProof(tree, 1);

console.log(`VECTOR state_leaf_alice=${toHex(l1)}`);
console.log(`VECTOR state_leaf_bob=${toHex(l2)}`);
console.log(`VECTOR withdrawal_leaf=${toHex(l3)}`);
console.log(`VECTOR root3=${toHex(tree.root)}`);
console.log(`VECTOR proof_of_leaf1_len=${proof.length}`);
for (const p of proof) console.log(`VECTOR proof_of_leaf1_sibling=${toHex(p)}`);
if (!verifyProof(l2, 1, proof, tree.root)) throw new Error('la prueba no verifica');
