/**
 * Árbol Merkle binario (SHA-256) idéntico al del contrato `flash-bridge`:
 *
 *   leaf_state      = sha256(0x00 || xdr(account) || xdr(token) || balance_i128_be || nonce_u64_be)
 *   node            = sha256(0x01 || left || right)         (hermano faltante = ZERO32)
 *   leaf_withdrawal = sha256(0x02 || batch_u64_be || w_index_u32_be || xdr(recipient) || xdr(token) || amount_i128_be)
 *   raíz vacía      = ZERO32 ; raíz de una sola hoja = la hoja
 *
 * Fase ZK (roadmap): sustituir SHA-256 por Poseidon2 (host functions del Protocolo 25) para que
 * las pruebas de validez sean baratas dentro de un circuito.
 */
import { ZERO32, bytesEqual, concat, encodeAddress, i128ToBytes, sha256, u32ToBytes, u64ToBytes } from './bytes.ts';

export const LEAF_STATE_TAG = 0x00;
export const NODE_TAG = 0x01;
export const LEAF_WITHDRAWAL_TAG = 0x02;

export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(new Uint8Array([NODE_TAG]), left, right);
}

export function stateLeaf(account: string, token: string, balance: bigint, nonce: bigint): Uint8Array {
  return sha256(
    new Uint8Array([LEAF_STATE_TAG]),
    encodeAddress(account),
    encodeAddress(token),
    i128ToBytes(balance),
    u64ToBytes(nonce),
  );
}

export function withdrawalLeaf(
  batchIndex: bigint,
  wIndex: number,
  recipient: string,
  token: string,
  amount: bigint,
): Uint8Array {
  return sha256(
    new Uint8Array([LEAF_WITHDRAWAL_TAG]),
    u64ToBytes(batchIndex),
    u32ToBytes(wIndex),
    encodeAddress(recipient),
    encodeAddress(token),
    i128ToBytes(amount),
  );
}

export interface MerkleTree {
  root: Uint8Array;
  /** layers[0] = hojas, layers[n-1] = [raíz] (para árbol no vacío). */
  layers: Uint8Array[][];
}

export function buildTree(leaves: Uint8Array[]): MerkleTree {
  if (leaves.length === 0) return { root: ZERO32, layers: [[]] };
  const layers: Uint8Array[][] = [leaves.slice()];
  let level = leaves;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : ZERO32;
      next.push(hashNode(level[i], right));
    }
    layers.push(next);
    level = next;
  }
  return { root: level[0], layers };
}

export function computeRoot(leaves: Uint8Array[]): Uint8Array {
  return buildTree(leaves).root;
}

export function getProof(tree: MerkleTree, index: number): Uint8Array[] {
  const proof: Uint8Array[] = [];
  let idx = index;
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l];
    const sib = idx ^ 1;
    proof.push(sib < layer.length ? layer[sib] : ZERO32);
    idx >>= 1;
  }
  return proof;
}

export function verifyProof(leaf: Uint8Array, index: number, proof: Uint8Array[], root: Uint8Array): boolean {
  let node = leaf;
  let idx = index;
  for (const sibling of proof) {
    node = (idx & 1) === 0 ? hashNode(node, sibling) : hashNode(sibling, node);
    idx >>= 1;
  }
  return idx === 0 && bytesEqual(node, root);
}

/** Clave canónica de una hoja de estado: define el orden de las hojas en el árbol. */
export function stateKeyBytes(account: string, token: string): Uint8Array {
  return concat(encodeAddress(account), encodeAddress(token));
}
