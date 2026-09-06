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

// `neutral`: el protocolo ya no depende de node:crypto ni de Buffer, así que el mismo bundle
// sirve para servidor y para navegador (la dapp de puente construye ahí el mensaje SEP-53).
const common = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'neutral',
  target: ['node20', 'es2022'],
  external: ['@stellar/stellar-sdk'],
  sourcemap: true,
};

await build({ ...common, format: 'esm', outfile: 'dist/index.js' });
await build({ ...common, format: 'cjs', platform: 'node', outfile: 'dist/index.cjs' });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
console.log('sdk: dist/index.js, dist/index.cjs y tipos listos');
