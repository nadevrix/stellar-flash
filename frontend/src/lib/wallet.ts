/**
 * Conexión con la wallet del usuario vía Stellar Wallets Kit (API estática, v2.6).
 *
 * Dos firmas distintas y conviene no confundirlas:
 *  - `signMessage`     → pagos dentro de Flash (SEP-53). No tocan la L1.
 *  - `signTransaction` → depósito: un pago XLM clásico a la cuenta del secuenciador (Horizon, no Soroban).
 */
import { Networks, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';

const STORAGE_KEY = 'flash.wallet.connected';
let started = false;

function start(): void {
  if (started) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [
      new FreighterModule(), new xBullModule(), new LobstrModule(),
      new AlbedoModule(), new HanaModule(), new RabetModule(),
    ],
  });
  started = true;
}

/** Abre el selector de wallets y devuelve la dirección elegida. */
export async function connectWallet(): Promise<string> {
  start();
  const { address } = await StellarWalletsKit.authModal();
  localStorage.setItem(STORAGE_KEY, '1');
  return address;
}

/** Reconecta en silencio si el usuario ya conectó antes. `null` si no hay sesión previa. */
export async function restoreWallet(): Promise<string | null> {
  if (!localStorage.getItem(STORAGE_KEY)) return null;
  try {
    start();
    const { address } = await StellarWalletsKit.getAddress();
    return address || null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function disconnectWallet(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    /* la wallet puede no soportarlo; basta con olvidar la sesión */
  }
}

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function fromBase64(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
}

/** Normaliza lo que Freighter / el kit devuelven (Base64, hex, o bytes) a 64 bytes ed25519. */
function decodeWalletSignature(signed: unknown): Uint8Array {
  if (signed instanceof Uint8Array) return signed;
  if (signed && typeof signed === 'object' && Array.isArray((signed as { data?: unknown }).data)) {
    return Uint8Array.from((signed as { data: number[] }).data);
  }
  if (typeof signed !== 'string') throw new Error('Wallet returned an unexpected signature format.');
  const s = signed.trim();
  if (/^[0-9a-fA-F]+$/.test(s) && s.length === 128) return fromHex(s);
  const b64 = fromBase64(s);
  if (b64.length === 64) return b64;
  throw new Error('Wallet returned an unexpected signature format.');
}

/**
 * Firma un mensaje SEP-53 y devuelve la firma en hex, que es lo que espera el API.
 * Freighter solo acepta un string UTF-8: le pasamos el hex de `domain||body` (el binario
 * no es UTF-8 válido). Los bytes los construye la dapp: si los diera el servidor, podría
 * enseñarte un pago en pantalla y hacerte firmar otro.
 */
export async function signFlashMessage(message: Uint8Array, address: string): Promise<string> {
  const { signedMessage } = await StellarWalletsKit.signMessage(toHex(message), {
    address,
    networkPassphrase: Networks.TESTNET,
  });
  const sig = decodeWalletSignature(signedMessage);
  if (sig.length !== 64) throw new Error('Wallet returned a signature that is not 64 bytes.');
  return toHex(sig);
}

/** Firma una transacción Stellar (XDR base64): pago XLM clásico hacia el onramp. */
export async function signStellarTx(xdr: string, address: string): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: Networks.TESTNET,
  });
  return signedTxXdr;
}
