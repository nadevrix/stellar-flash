# 10 · Roadmap, demo para Stellar Elite y camino a financiación

## 1. Estado actual (7-sep-2026)

Hecho y probado:
- Contrato, protocolo, secuenciador, SDK (como antes).
- **Testnet E2E en producción** (Render): depósito, pagos, lotes, retiro Merkle.
- **Frontend completo** desplegado: Bridge, Account, Explorer, Developers (`08-frontend.md` actualizado).
- **14 tests TS** + fix anti mint infinito en depósitos.
- **UI** estilo Stellar Lab; documentación pública en inglés (`docs/README.md`, `11-product-and-deployment.md`).

No hecho (Fase 2+):
- API keys, webhooks, Postgres, SSE.
- Pruebas de fraude, ZK, npm publish SDK.
- Replay batch verificable en browser.

### Fase 0 · Testnet end-to-end — **completada**
Ver BITACORA sesiones 10–12 y `11-product-and-deployment.md`.

### Fase 1 · MVP demostrable — **en curso / casi lista**
- Done: Frontend Explorer + Bridge desplegados (Render).
- Done: Landing + producto usable.
- Planned: Integración referencia bounty (script `examples/bounty-pay.ts` existe; falta demo grabada).
- Done: Docs README inglés (sep 2026).

### Fase 2 · Seguridad económica e ingresos (3–6 semanas)
- Planes y cobro (Stripe); API keys; webhooks de txs L2.
- Pruebas de fraude (`challenge_batch`) + bond del secuenciador + raíces intermedias en `commit_batch`.
- Watchtower open-source (CLI que sigue el contrato, re-ejecuta lotes y alerta/desafía).
- Auditoría del contrato (pedir apoyo en SCF/SDF: hay programas de auditoría subvencionada).
- Postgres + réplica pasiva; API keys; métricas.
- **Mainnet limitado** (límite de depósito por cuenta, tokens XLM/USDC).

### Fase 2.5 · Escala del estado y firma legible
Dos cambios que tocan contrato + protocolo + vectores a la vez, así que van juntos:
- **Árbol Merkle incremental.** Hoy `root()` reconstruye el árbol entero en cada lote: ~31 µs por
  cuenta (medido), lo que pone un muro en ~50–65 mil cuentas con sellado cada 2 s. Con
  actualización incremental pasa a O(log n) y deja de ser un límite.
- **Mensaje de firma legible.** Hoy el usuario firma bytes binarios y la wallet le enseña
  hexadecimal: no puede leer "pagar 10 XLM a G…". Cambiar el formato del mensaje a texto legible
  cierra ese hueco de confianza.

### Fase 3 · ZK (2–4 meses)
- Poseidon2 en hojas/nodos; circuito de transición de estado (Noir/Circom) o zkVM (RISC Zero) con verificador Groth16/UltraHonk en Soroban (BN254, P25).
- `commit_batch_zk`: sin periodo de desafío → retiros en 1 ledger.
- Compresión de datos (índices de cuenta, sin firmas en DA) → ~2 500 tx/s de capacidad DA.

### Fase 4 · Descentralización y cómputo general
- Inclusión forzada vía L1; rotación de secuenciadores con stake; token de gobernanza si hace falta.
- "Flash VM": ejecutar contratos Soroban dentro de Flash (soroban-env-host off-chain) con pruebas de validez vía zkVM. Es el equivalente a Nitro/Stylus.

## 3. Demo para Stellar Elite (guion de 5 minutos)

1. (30 s) **El problema con datos**: incidente RPC feb-2026, 5–6 s por ledger, 60–75 % de uso, tx_bad_seq en pagos masivos. "No es que Stellar falle: es que la UX depende de infraestructura que sí falla y de 5 segundos que en un checkout son una eternidad."
2. (60 s) **La idea en una frase**: FXLM. Analogía Arbitrum. Diagrama de `04-arquitectura-tecnica.md`.
3. (120 s) **Demo en vivo** (`npm run demo` o el Explorer si ya existe): depósito → 200 pagos en 500 ms → lote en L1 → "apagamos Stellar" → 300 pagos siguen confirmando → surge pricing difiere → vuelve → lotes en orden → verificación independiente → prueba Merkle de retiro.
4. (45 s) **Lo que ya existe**: contrato en testnet (hash), tests, SDK drop-in de 3 líneas. Enseñar el `transfer()` del SDK.
5. (45 s) **Por qué ahora y qué pedimos**: P25 trae BN254/Poseidon (SDF quiere rollups), nadie lo ha hecho, LATAM necesita pagos instantáneos; pedimos mentoría de SDF para pruebas de fraude/ZK y acceso a SCF.

Tips: tener el JSON de `GET /v1/health` en una pestaña; mostrar `latencyUs` real en pantalla; enlazar el `l1TxHash` a stellar.expert en vivo.

## 4. Financiación

- **Stellar Community Fund (SCF)**: Build Award (hasta ~150k USD en XLM por tramos) para infraestructura. Requiere: MVP en testnet, roadmap, equipo, comunidad. Los programas de BAF (Código Alebrije Scale, Impacta) están diseñados como preparación para SCF; usar a los mentores del programa para revisar la aplicación.
- **SDF grants / bounties de infraestructura**: preguntar en el programa por bounties de "ZK on Stellar" (hay ejemplos financiados: Stellar Private Payments de Nethermind, verificador UltraHonk).
- **Aceleradoras web3 LATAM y VC**: solo tras Fase 2 (mainnet limitado, métricas reales).

## 5. Métricas que importan (para SCF y para nosotros)
- Latencia p50/p99 de confirmación L2; tx/s sostenidas.
- Nº de lotes publicados y coste medio en XLM por 1 000 pagos.
- Tiempo de recuperación tras caída de RPC (segundos desde que L1 vuelve hasta que el backlog se publica).
- Apps integradas y pagos por día; retiros completados y tiempo medio hasta `finalized`.
- Verificaciones independientes de lotes (descargas del watchtower).
