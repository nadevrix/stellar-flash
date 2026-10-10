import { Networks } from '@stellar/stellar-sdk';

/** Passphrase que publica el secuenciador. El kit y Stellar Expert la leen de aquí. */
let passphrase: string = Networks.TESTNET;

export function setNetworkPassphrase(p: string): void {
  if (p) passphrase = p;
}

export function networkPassphrase(): string {
  return passphrase;
}

export function isPublicNetwork(p?: string): boolean {
  return (p ?? passphrase) === Networks.PUBLIC;
}

export function kitNetwork(p?: string): typeof Networks.PUBLIC | typeof Networks.TESTNET {
  return isPublicNetwork(p) ? Networks.PUBLIC : Networks.TESTNET;
}

export function expertExplorer(p = passphrase) {
  const net = isPublicNetwork(p) ? 'public' : 'testnet';
  return {
    tx: (h: string) => `https://stellar.expert/explorer/${net}/tx/${h}`,
    contract: (id: string) => `https://stellar.expert/explorer/${net}/contract/${id}`,
    account: (g: string) => `https://stellar.expert/explorer/${net}/account/${g}`,
  };
}
