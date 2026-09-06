import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { connectWallet, disconnectWallet, restoreWallet } from '../lib/wallet.ts';

interface WalletCtx {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => { void restoreWallet().then((a) => a && setAddress(a)); }, []);

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
