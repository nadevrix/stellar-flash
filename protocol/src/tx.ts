/**
 * Transacciones L2 de Stellar Flash y su codificación canónica.
 *
 * Identidades L2 = las mismas llaves ed25519 de Stellar (direcciones `G...`). Un usuario firma
 * transacciones Flash con la misma llave con la que firma en Stellar: no hay wallet nueva.
 *
 * Firma (compatible con SEP-53, el estándar de firma de mensajes de Stellar):
 *   message = domain || body
 *   sig     = ed25519( sha256("Stellar Signed Message:\n" || message) )
 *   domain  = sha256("stellar-flash-v0" || network_passphrase || xdr(bridge_contract))
 * El dominio liga la firma a una red y a un despliegue del puente (sin replay entre redes/instancias),
 * y el prefijo SEP-53 garantiza que una firma de Flash jamás se confunde con una tx Stellar.
 *
 * Codificación de lote (data availability publicada en L1 dentro de `commit_batch.tx_data`):
 *   u32 count || repeat(u16 len || tx_bytes)
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  bytesToI128,
  bytesToU32,
  bytesToU64,
  concat,
  decodeAddress,
  encodeAddress,
  fromHex,
  i128ToBytes,
  isValidL2Address,
  sha256,
  toHex,
  u16ToBytes,
  u32ToBytes,
  u64ToBytes,
  utf8,
} from './bytes.ts';

export const TX_TRANSFER = 0x10;
export const TX_WITHDRAW = 0x11;
export const TX_DEPOSIT = 0x12;

export interface TransferTx {
  type: 'transfer';
  from: string;
  to: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  signature: Uint8Array; // 64 bytes ed25519
}

export interface WithdrawTx {
  type: 'withdraw';
  from: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  /** Cuenta Stellar (L1) que recibirá los fondos al reclamar el retiro en el puente. */
  l1Recipient: string;
  signature: Uint8Array;
}

/** Derivada de un evento `deposit` del contrato en L1; no lleva firma de usuario. */
export interface DepositTx {
  type: 'deposit';
  depositIndex: bigint;
  to: string;
  token: string;
  amount: bigint;
  /** Hash (32 bytes hex) de la transacción L1 que hizo el depósito. */
  l1TxHash: string;
}

export type SignedTx = TransferTx | WithdrawTx;
export type L2Tx = SignedTx | DepositTx;

export interface FlashDomain {
  networkPassphrase: string;
  bridgeContractId: string;
}

export function domainSeparator(d: FlashDomain): Uint8Array {
  return sha256(utf8('stellar-flash-v0'), utf8(d.networkPassphrase), encodeAddress(d.bridgeContractId));
}

/** Cuerpo canónico sin firma. */
export function txBody(tx: L2Tx): Uint8Array {
  switch (tx.type) {
    case 'transfer':
      return concat(
        new Uint8Array([TX_TRANSFER]),
        encodeAddress(tx.from),
        encodeAddress(tx.to),
        encodeAddress(tx.token),
        i128ToBytes(tx.amount),
        u64ToBytes(tx.nonce),
      );
    case 'withdraw':
      return concat(
        new Uint8Array([TX_WITHDRAW]),
        encodeAddress(tx.from),
        encodeAddress(tx.l1Recipient),
        encodeAddress(tx.token),
        i128ToBytes(tx.amount),
        u64ToBytes(tx.nonce),
      );
    case 'deposit':
      return concat(
        new Uint8Array([TX_DEPOSIT]),
        u64ToBytes(tx.depositIndex),
        encodeAddress(tx.to),
        encodeAddress(tx.token),
        i128ToBytes(tx.amount),
        fromHex(tx.l1TxHash),
      );
  }
}

/** Prefijo SEP-53 ("Sign and Verify Messages"): lo que usan Freighter, el CLI y todos los SDKs. */
export const SEP53_PREFIX: Uint8Array = utf8('Stellar Signed Message:\n');

/**
 * Mensaje que firma el usuario (bytes): `domain || body`. Una wallet que implemente SEP-53
 * (`keypair.signMessage(bytes)`, Freighter `signMessage`) produce exactamente la firma que Flash espera.
 */
export function signingMessage(tx: SignedTx | Omit<SignedTx, 'signature'>, domain: Uint8Array): Uint8Array {
  return concat(domain, txBody({ ...tx, signature: new Uint8Array(64) } as SignedTx));
}

/** Digest firmado con ed25519 según SEP-53: sha256("Stellar Signed Message:\n" || domain || body). */
export function signingPayload(tx: SignedTx | Omit<SignedTx, 'signature'>, domain: Uint8Array): Uint8Array {
  return sha256(SEP53_PREFIX, signingMessage(tx, domain));
}

export function signTx<T extends Omit<TransferTx, 'signature'> | Omit<WithdrawTx, 'signature'>>(
  tx: T,
  keypair: Keypair,
  domain: Uint8Array,
): T & { signature: Uint8Array } {
  if (keypair.publicKey() !== tx.from) throw new Error('la llave no corresponde a `from`');
  const sig = keypair.sign(Buffer.from(signingPayload(tx as SignedTx, domain)));
  return { ...tx, signature: new Uint8Array(sig) };
}

export function verifyTxSignature(tx: SignedTx, domain: Uint8Array): boolean {
  if (!isValidL2Address(tx.from) || !tx.from.startsWith('G')) return false; // solo cuentas ed25519 firman
  if (tx.signature.length !== 64) return false;
  try {
    return Keypair.fromPublicKey(tx.from).verify(Buffer.from(signingPayload(tx, domain)), Buffer.from(tx.signature));
  } catch {
    return false;
  }
}

/** Codificación completa (cuerpo + firma si aplica). */
export function encodeTx(tx: L2Tx): Uint8Array {
  const body = txBody(tx);
  if (tx.type === 'deposit') return body;
  if (tx.signature.length !== 64) throw new Error('firma debe tener 64 bytes');
  return concat(body, tx.signature);
}

export function decodeTx(bytes: Uint8Array, offset = 0): { tx: L2Tx; next: number } {
  const tag = bytes[offset];
  let off = offset + 1;
  const readAddr = () => {
    const r = decodeAddress(bytes, off);
    off = r.next;
    return r.address;
  };
  const readI128 = () => {
    const v = bytesToI128(bytes.subarray(off, off + 16));
    off += 16;
    return v;
  };
  const readU64 = () => {
    const v = bytesToU64(bytes.subarray(off, off + 8));
    off += 8;
    return v;
  };
  const readSig = () => {
    const s = bytes.slice(off, off + 64);
    if (s.length !== 64) throw new Error('firma truncada');
    off += 64;
    return s;
  };
  switch (tag) {
    case TX_TRANSFER: {
      const from = readAddr(), to = readAddr(), token = readAddr(), amount = readI128(), nonce = readU64();
      return { tx: { type: 'transfer', from, to, token, amount, nonce, signature: readSig() }, next: off };
    }
    case TX_WITHDRAW: {
      const from = readAddr(), l1Recipient = readAddr(), token = readAddr(), amount = readI128(), nonce = readU64();
      return { tx: { type: 'withdraw', from, token, amount, nonce, l1Recipient, signature: readSig() }, next: off };
    }
    case TX_DEPOSIT: {
      const depositIndex = readU64(), to = readAddr(), token = readAddr(), amount = readI128();
      const l1TxHash = toHex(bytes.subarray(off, off + 32));
      off += 32;
      return { tx: { type: 'deposit', depositIndex, to, token, amount, l1TxHash }, next: off };
    }
    default:
      throw new Error(`tipo de tx desconocido: ${tag}`);
  }
}

/** Identificador único de una tx L2 (hex de 32 bytes). */
export function txId(tx: L2Tx, domain: Uint8Array): string {
  return toHex(sha256(domain, encodeTx(tx)));
}

export function encodeBatchData(txs: L2Tx[]): Uint8Array {
  const parts: Uint8Array[] = [u32ToBytes(txs.length)];
  for (const tx of txs) {
    const b = encodeTx(tx);
    parts.push(u16ToBytes(b.length), b);
  }
  return concat(...parts);
}

export function decodeBatchData(bytes: Uint8Array): L2Tx[] {
  const count = bytesToU32(bytes.subarray(0, 4));
  let off = 4;
  const txs: L2Tx[] = [];
  for (let i = 0; i < count; i++) {
    const len = (bytes[off] << 8) | bytes[off + 1];
    off += 2;
    const { tx, next } = decodeTx(bytes, off);
    if (next !== off + len) throw new Error(`longitud de tx ${i} inconsistente`);
    off = next;
    txs.push(tx);
  }
  if (off !== bytes.length) throw new Error('bytes sobrantes en el lote');
  return txs;
}

/** Serialización JSON amigable (bigint → string, bytes → hex) para API/SDK. */
export function txToJson(tx: L2Tx): Record<string, unknown> {
  switch (tx.type) {
    case 'transfer':
      return { type: tx.type, from: tx.from, to: tx.to, token: tx.token, amount: tx.amount.toString(), nonce: tx.nonce.toString(), signature: toHex(tx.signature) };
    case 'withdraw':
      return { type: tx.type, from: tx.from, token: tx.token, amount: tx.amount.toString(), nonce: tx.nonce.toString(), l1Recipient: tx.l1Recipient, signature: toHex(tx.signature) };
    case 'deposit':
      return { type: tx.type, depositIndex: tx.depositIndex.toString(), to: tx.to, token: tx.token, amount: tx.amount.toString(), l1TxHash: tx.l1TxHash };
  }
}

export function txFromJson(j: Record<string, unknown>): L2Tx {
  const str = (k: string): string => {
    const v = j[k];
    if (typeof v !== 'string') throw new Error(`campo '${k}' requerido`);
    return v;
  };
  const big = (k: string): bigint => {
    const v = str(k);
    if (!/^-?\d+$/.test(v)) throw new Error(`campo '${k}' debe ser entero en string`);
    return BigInt(v);
  };
  switch (j.type) {
    case 'transfer':
      return { type: 'transfer', from: str('from'), to: str('to'), token: str('token'), amount: big('amount'), nonce: big('nonce'), signature: fromHex(str('signature')) };
    case 'withdraw':
      return { type: 'withdraw', from: str('from'), token: str('token'), amount: big('amount'), nonce: big('nonce'), l1Recipient: str('l1Recipient'), signature: fromHex(str('signature')) };
    case 'deposit':
      return { type: 'deposit', depositIndex: big('depositIndex'), to: str('to'), token: str('token'), amount: big('amount'), l1TxHash: str('l1TxHash') };
    default:
      throw new Error(`type inválido: ${String(j.type)}`);
  }
}
