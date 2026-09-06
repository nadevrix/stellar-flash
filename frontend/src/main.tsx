import { Buffer } from 'buffer';
import { StrictMode } from 'react';

// `@stellar/stellar-sdk` usa `Buffer` internamente y en el navegador no existe.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { Landing } from './pages/Landing.tsx';
import { Explorer } from './pages/Explorer.tsx';
import { Developers } from './pages/Developers.tsx';
import { Bridge } from './pages/Bridge.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/developers" element={<Developers />} />
        <Route path="/bridge" element={<Bridge />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
