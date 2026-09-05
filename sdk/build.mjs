/**
 * Empaqueta el SDK para npm. El paquete tiene que ser autocontenido: en el repo el SDK importa
 * `../../protocol/src/index.ts` por ruta relativa (Node no hace type stripping dentro de
 * node_modules, por eso no hay workspaces), así que aquí se inlinea el protocolo en el bundle.
 * `@stellar/stellar-sdk` queda fuera: es peerDependency, no queremos dos copias en el consumidor.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync(new URL('dist', import.meta.url), { recursive: true, force: true });

// Plataforma Node: el protocolo usa `node:crypto` para sha256. Para usar el SDK en el navegador
// (la dapp de puente de docs/08) habrá que sustituir esa dependencia por un sha256 portable.
const common = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['@stellar/stellar-sdk'],
  sourcemap: true,
};

await build({ ...common, format: 'esm', outfile: 'dist/index.js' });
await build({ ...common, format: 'cjs', outfile: 'dist/index.cjs' });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
console.log('sdk: dist/index.js, dist/index.cjs y tipos listos');
