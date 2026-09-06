import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // El SDK se consume desde el código fuente del repo, no desde npm: así la dapp y el
      // secuenciador comparten exactamente el mismo protocolo y no pueden desincronizarse.
      '@flash/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
    },
  },
  define: {
    // `@stellar/stellar-sdk` espera el global `Buffer` (nuestro protocolo ya no lo necesita).
    global: 'globalThis',
  },
  optimizeDeps: { include: ['buffer'] },
  server: {
    // Permite servir el SDK y el protocolo, que viven fuera de `frontend/`.
    fs: { allow: ['..'] },
  },
});
