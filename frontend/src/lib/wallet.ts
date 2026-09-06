/**
 * Conexión con la wallet del usuario vía Stellar Wallets Kit (API estática, v2.6).
 *
 * Dos firmas distintas y conviene no confundirlas:
 *  - `signMessage`     → pagos dentro de Flash (SEP-53). No tocan la L1.
 *  - `signTransaction` → depósito y reclamo del retiro: transacciones de Stellar de verdad.
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

const toBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Firma un mensaje SEP-53 y devuelve la firma en hex, que es lo que espera el API.
 * Los bytes los construye la dapp en el navegador: si los diera el servidor, podría enseñarte
 * un pago en pantalla y hacerte firmar otro.
 */
export async function signFlashMessage(message: Uint8Array, address: string): Promise<string> {
  const { signedMessage } = await StellarWalletsKit.signMessage(toBase64(message), { address });
  return toHex(fromBase64(signedMessage));
}

/** Firma una transacción Stellar (XDR base64) para depositar o reclamar un retiro. */
export async function signStellarTx(xdr: string, address: string): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: Networks.TESTNET,
  });
  return signedTxXdr;
}
