import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useHealth } from '../components/LiveStatus.tsx';
import { setNetworkPassphrase } from '../lib/network.ts';
import { connectWallet, disconnectWallet, restoreWallet } from '../lib/wallet.ts';

interface WalletCtx {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { health } = useHealth(8000);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (health?.network.passphrase) setNetworkPassphrase(health.network.passphrase);
  }, [health?.network.passphrase]);

  useEffect(() => {
    if (!health?.network.passphrase) return;
    void restoreWallet().then((a) => a && setAddress(a));
  }, [health?.network.passphrase]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try { setAddress(await connectWallet()); } finally { setConnecting(false); }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setAddress(null);
  }, []);

  return (
    <Ctx.Provider value={{ address, connecting, connect, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
