/**
 * Utilidades de bytes/hashing compartidas por protocolo, secuenciador y SDK.
 * Toda la codificación es big-endian y determinista: debe coincidir byte a byte con
 * `contracts/flash-bridge/src/lib.rs`.
 */
import { createHash } from 'node:crypto';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';

export const ZERO32: Uint8Array = new Uint8Array(32);

// Discriminantes XDR (Stellar-contract.x): ScValType::SCV_ADDRESS y ScAddressType.
const SCV_ADDRESS = 18;
const SC_ADDRESS_TYPE_ACCOUNT = 0;
const SC_ADDRESS_TYPE_CONTRACT = 1;

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);
const U64_MAX = (1n << 64n) - 1n;

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`hex inválido: ${hex}`);
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Comparación lexicográfica (orden canónico de hojas del árbol de estado). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export function i128ToBytes(v: bigint): Uint8Array {
  if (v > I128_MAX || v < I128_MIN) throw new RangeError(`i128 fuera de rango: ${v}`);
  let x = v < 0n ? v + (1n << 128n) : v;
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export function bytesToI128(b: Uint8Array): bigint {
  if (b.length !== 16) throw new RangeError('i128 requiere 16 bytes');
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x > I128_MAX ? x - (1n << 128n) : x;
}

export function u64ToBytes(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new RangeError(`u64 fuera de rango: ${v}`);
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export function bytesToU64(b: Uint8Array): bigint {
  if (b.length !== 8) throw new RangeError('u64 requiere 8 bytes');
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x;
}

export function u32ToBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 fuera de rango: ${n}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

export function bytesToU32(b: Uint8Array): number {
  if (b.length !== 4) throw new RangeError('u32 requiere 4 bytes');
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false);
}

export function u16ToBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`u16 fuera de rango: ${n}`);
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

/** Direcciones aceptadas como identidad L2: cuentas `G...` y contratos `C...`. */
export function isValidL2Address(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr);
}

/**
 * Codifica una dirección como XDR de `ScVal::Address` — exactamente lo que produce
 * `Address::to_xdr(&env)` en soroban-sdk. 44 bytes para `G...`, 40 bytes para `C...`.
 */
export function encodeAddress(addr: string): Uint8Array {
  if (!isValidL2Address(addr)) throw new Error(`dirección L2 inválida: ${addr}`);
  return new Uint8Array(Address.fromString(addr).toScVal().toXDR());
}

/** Decodifica un `ScVal::Address` XDR desde `bytes[offset..]` y devuelve la dirección y el offset siguiente. */
export function decodeAddress(bytes: Uint8Array, offset: number): { address: string; next: number } {
  // ScVal discriminant (4) = SCV_ADDRESS(18); ScAddress type (4): 0 = account, 1 = contract
  if (bytes.length < offset + 8) throw new Error('bytes insuficientes para dirección');
  const scvType = bytesToU32(bytes.subarray(offset, offset + 4));
  if (scvType !== SCV_ADDRESS) throw new Error(`ScVal no es Address: ${scvType}`);
  const addrType = bytesToU32(bytes.subarray(offset + 4, offset + 8));
  let len: number;
  if (addrType === SC_ADDRESS_TYPE_ACCOUNT) len = 44;
  else if (addrType === SC_ADDRESS_TYPE_CONTRACT) len = 40;
  else throw new Error(`tipo de ScAddress no soportado en L2: ${addrType}`);
  if (bytes.length < offset + len) throw new Error('bytes insuficientes para dirección');
  const scval = xdr.ScVal.fromXDR(Buffer.from(bytes.subarray(offset, offset + len)));
  return { address: Address.fromScVal(scval).toString(), next: offset + len };
}
