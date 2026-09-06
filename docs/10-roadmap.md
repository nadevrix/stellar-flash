# 10 · Roadmap, demo para Stellar Elite y camino a financiación

## 1. Estado actual (4-sep-2026)

Hecho y probado:
- Contrato `flash-bridge` (Soroban, P27): depósitos, lotes con DA en L1, retiros con prueba Merkle, escape hatch, devolución de depósitos, pausa, admin. 11 tests. WASM 18.7 KB.
- Protocolo compartido Rust ↔ TS con vectores idénticos; firma SEP-53 compatible con wallets.
- Secuenciador: finalidad L2 en ~2 ms, lotes con límites, log SQLite con recuperación, motor de settlement con salud L1 (HEALTHY/DEGRADED/DOWN), política de fees, backoff, reconciliación; API HTTP; SDK; demo end-to-end. 13 tests TS.

No hecho:
- Prueba en **testnet real** (script listo: `scripts/deploy-testnet.sh`).
- Frontend (especificado en `08-frontend.md`).
- Pruebas de fraude, ZK, inclusión forzada, multi-secuenciador (especificados en `05-contratos-soroban.md`).
- Auth/API keys/rate limiting; Postgres; SSE.

## 2. Fases

### Fase 0 · Testnet end-to-end (1–2 días) — **siguiente paso**
1. `bash scripts/deploy-testnet.sh` → contrato en testnet + depósito de prueba.
2. Arrancar el secuenciador en `L1_MODE=rpc`; comprobar que acredita el depósito (getEvents) y publica el primer lote (`commit_batch` real). Ajustar parseo de eventos/errores si el SDK v17 difiere.
3. Medir coste real de `commit_batch` con 60–120 KB → fijar `MAX_BATCH_BYTES`.
4. Retiro completo: `withdraw` en L2 → esperar 20 ledgers → `buildWithdrawClaimTx` → XLM de vuelta en la cuenta. Guardar hashes para el pitch.
5. Simular "L1 caída" real: apuntar `RPC_URLS` a un endpoint inexistente durante 1 minuto y ver HOLD → recuperación.

### Fase 1 · MVP demostrable y vendible (1–2 semanas)
- Frontend Explorer + Bridge (según `08-frontend.md`), desplegado (Vercel/Netlify) apuntando a un secuenciador en testnet (Fly.io/Railway/VPS). Página pública de estado de Stellar (nuestro monitor).
- Integración de referencia: una "plataforma de bounties" mínima que paga 100 destinatarios en **FXLM** en < 1 s. Es el caso de uso de arranque: una plataforma deposita su float una vez y a partir de ahí paga dentro de Flash, de forma que sus destinatarios reciben sin tocar la L1.
- Optimización: `sodium-native`, micro-lotes de escritura → objetivo 2 000+ tx/s.
- Docs públicas + README en inglés.

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
