import { Buffer } from 'buffer';
import { StrictMode } from 'react';

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { AppShell } from './components/AppShell.tsx';
import { WalletProvider } from './context/WalletContext.tsx';
import { Landing } from './pages/Landing.tsx';
import { Explorer } from './pages/Explorer.tsx';
import { Developers } from './pages/Developers.tsx';
import { Bridge } from './pages/Bridge.tsx';
import { Account } from './pages/Account.tsx';
import { AccountPublic } from './pages/AccountPublic.tsx';
import { TxDetail } from './pages/TxDetail.tsx';
import { BatchDetail } from './pages/BatchDetail.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bridge" element={<Bridge />} />
            <Route path="/account" element={<Account />} />
            <Route path="/accounts/:address" element={<AccountPublic />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/tx/:id" element={<TxDetail />} />
            <Route path="/batches/:index" element={<BatchDetail />} />
            <Route path="/developers" element={<Developers />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </AppShell>
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>,
);
