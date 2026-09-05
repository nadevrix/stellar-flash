# 01 · Diagnóstico: ¿por qué "Stellar se laguea"?

> Objetivo: entender **a fondo** qué falla cuando una app sobre Stellar se queda "en proceso", se ve caída o tarda, para atacar la causa real y no el síntoma. Todo lo de abajo está respaldado con datos tomados el 4-sep-2026 y con incidentes públicos.

## 1. Lo que la red hace realmente (datos de mainnet, 4-sep-2026)

| Métrica | Valor observado | Fuente |
|---|---|---|
| Protocolo | 27 (stellar-core 27.1.0) | `getVersionInfo` en `mainnet.sorobanrpc.com` |
| Tiempo entre ledgers | 5–6 s (promedio 5.55 s en 12 ledgers) | Horizon `/ledgers` |
| Objetivo de cierre configurado | 5000 ms (`ledger_target_close_time_milliseconds`) | `getLedgerEntries` → `ConfigSettingScpTiming` |
| Txs por ledger | ~240–300 exitosas, 520–740 operaciones | Horizon |
| Capacidad clásica | 1000 operaciones/ledger (`max_tx_set_size`) | Horizon |
| Capacidad Soroban | 2000 txs/ledger; 132 096 bytes por tx; 266 240 bytes de txs por ledger | `ConfigSettingContractExecutionLanes`, `ConfigSettingContractBandwidthV0` |
| Fee de inclusión | p50 100–200 stroops, p99 200 (últimos 50 ledgers) | `getFeeStats` |

Conclusiones:

1. **La red no es lenta ni se cae con frecuencia.** Un ledger cada ~5.5 s con finalidad inmediata (SCP no tiene reorgs). Con 520–740 ops sobre 1000, la utilización ronda **60–75 %**: en picos entra en *surge pricing* con facilidad.
2. **La finalidad "instantánea" de Stellar es de 5–6 segundos en el mejor caso.** Para un checkout, un pago en vivo o una demo, 5 s de spinner ya se percibe como "lento", y cualquier sobrecarga lo convierte en 10–30 s.

## 2. Las causas reales de "se quedó en procesando"

### 2.1 Infraestructura de acceso (Horizon / Stellar RPC), no consenso

- **20–22 feb 2026 — Stellar RPC caído en todas las instancias** (ingestión rota). Texto oficial del incidente: *"We're currently investigating an issue that is causing downtime for Stellar RPC, all instances are affected. **The Stellar network itself is operating normally and no funds are at risk**"*. Se arregló con `stellar-rpc v25.0.1` un día después. ([IsDown/Status Stellar](https://isdown.app/status/stellar-org/incidents/539510-stellar-rpc-ingestion-issues-and-downtime))
- Los endpoints públicos (`soroban-testnet.stellar.org`, `horizon.stellar.org`) tienen **rate limits** y son compartidos por todo el ecosistema. En un evento/hackathon con muchos equipos pegándole a la vez, devuelven 429/504 aunque la red esté perfecta.
- `stellar-rpc` solo retiene ~7 días de historia (`history-retention-window` = 120 960 ledgers); consultas fuera de ventana devuelven `NOT_FOUND` y las apps lo muestran como error.
- Condiciones de carrera entre "último ledger" y "tx ingerida" (ver [stellar-rpc PR #619](https://github.com/stellar/stellar-rpc/pull/619)): el cliente ve la tx como no encontrada un instante después de que ya está en un ledger.

**Para el usuario esto se ve exactamente como "la página se cayó" o "la transacción no avanza"**, aunque la cadena esté bien.

### 2.2 `sendTransaction` no es confirmación

Stellar RPC devuelve `PENDING` tras **encolar** la tx: *"Unlike Horizon, this does not wait for transaction completion. It simply validates and enqueues the transaction"*. La app debe hacer polling de `getTransaction` hasta `SUCCESS`/`FAILED`. Muchas apps muestran "procesando" y nunca resuelven porque:
- no hacen polling, o lo hacen sin límite ni backoff;
- no ponen `timebounds`, así que la tx puede entrar minutos después o nunca, sin que el cliente sepa cuál;
- reciben `TRY_AGAIN_LATER` (cola llena) y no reintentan.

### 2.3 Surge pricing y pujas de fee fijas

Cuando un ledger se llena (o hay competencia por recursos Soroban), la red **elige por fee máxima ofrecida**. Las apps que ponen `BASE_FEE = 100` fijo se quedan fuera del ledger indefinidamente hasta que baje la carga. `getFeeStats` existe precisamente para pujar según el p50/p90 actual, pero casi nadie lo usa. Los fee-bump transactions permiten subir la puja sin volver a firmar, y tampoco se usan.

### 2.4 Números de secuencia: `tx_bad_seq` y transacciones encadenadas

Cada cuenta tiene un número de secuencia estrictamente incremental. Consecuencias:
- Una app que **paga a muchos usuarios desde una sola cuenta** (un pagador de bounties, una nómina, un juego) no puede enviar txs en paralelo: la segunda choca con `tx_bad_seq` o se queda "atascada detrás" de la primera. SDF llegó a proponer limitar a **1 tx por cuenta origen por ledger** (["Proposed changes to transaction submission"](https://stellar.org/blog/developers/proposed-changes-to-transaction-submission)): *"if account A submits T1..TN to the queue, while the network is in surge pricing, all new transactions will be stuck until T1 is included in the ledger (even if T2…TN have very high fees). Even worse, if T1 is dropped, all subsequent transactions have to be dropped and re-submitted."*
- La solución oficial son **channel accounts** (cuentas "canal" que aportan secuencia y fee mientras la cuenta base aporta los fondos). Requiere infraestructura que la mayoría de equipos de hackathon no monta.

Este es casi con certeza el patrón detrás de pagos de bounties que "una IA transfiere a todos" y tardan una semana: N pagos en serie desde una cuenta, con fallos que hay que detectar y reintentar a mano.

### 2.5 Propagación de estado y trustlines

Patrón que se repite cuando dos servicios integrados leen Horizon por su cuenta: el servicio A crea una trustline, el servicio B la consulta antes de que Horizon la haya propagado y recibe un 400. El parche habitual es un `setTimeout` de un par de segundos antes de reintentar. Es decir: integraciones que leen Horizon en instantes distintos ven estados distintos y fallan de forma intermitente, sin que ninguno de los dos servicios tenga un bug.

### 2.6 UX de wallets

Freighter/otros abren un popup por transacción, la firman, la envían y esperan el ledger. Cinco a seis segundos de spinner **por cada acción**. Si además la RPC pública responde lento, el usuario percibe una app rota.

## 3. Tabla síntoma → causa → cómo lo resuelve Stellar Flash

| Síntoma que ve el usuario | Causa raíz | Solución en Flash |
|---|---|---|
| "La página se cayó" durante una demo | RPC/Horizon público caído o con rate limit | La app habla con el secuenciador Flash, no con la RPC. Flash usa **varios RPC con failover** y solo los necesita para *settlement*, no para la UX. |
| Spinner de 5–30 s por pago | Tiempo de ledger (5 s) + polling mal hecho + surge | **Finalidad L2 en < 5 ms** (medido en la demo: p50 ≈ 2 ms en un solo hilo). El settlement a L1 ocurre después, en lotes. |
| "En proceso" para siempre | `PENDING` sin polling, sin timebounds, `TRY_AGAIN_LATER` ignorado | El **submitter** de Flash hace polling con deadline, clasifica errores (`TRY_AGAIN_LATER`, `TIMEOUT`, `TX_FAILED`, `NETWORK`) y reintenta con backoff. |
| Pagos masivos que fallan a medias | `tx_bad_seq`, 1 tx/cuenta/ledger | En Flash **no hay números de secuencia globales**: cada cuenta tiene un nonce por token y el secuenciador ordena. 1000 pagos = 1 tx L1. |
| Fees impredecibles en picos | surge pricing con fee fija | Política de settlement con **puja dinámica** (1.5× p90 sana; 2× p90 si urgente; tope configurable) y **diferir** lo no urgente hasta que baje. |
| Estado inconsistente entre servicios | lecturas de Horizon en instantes distintos | Una sola fuente de verdad L2 (el secuenciador) con estado determinista y raíz Merkle verificable. |

## 4. Lo que Flash **no** arregla (honestidad técnica)

- Si Stellar L1 está caída, **los retiros a L1 y los depósitos desde L1 esperan** hasta que vuelva. Lo que no espera es todo lo que pasa dentro de Flash (pagos entre usuarios, apps, juegos, comercios).
- Flash añade un componente (el secuenciador) que puede caerse. Por eso el diseño garantiza que **los fondos nunca dependen de él**: contrato con retiros por prueba Merkle, escape hatch y devolución de depósitos no acreditados (ver `04-arquitectura-tecnica.md`).
- La confirmación L2 es "el secuenciador se comprometió a incluir esto en el próximo lote". La garantía criptográfica completa llega cuando el lote se publica en L1 y pasa el periodo de desafío (igual que en Arbitrum: *soft finality* en ~ms, *hard finality* en L1).

## 5. Referencias

- Incidente RPC feb-2026: https://isdown.app/status/stellar-org/incidents/539510-stellar-rpc-ingestion-issues-and-downtime
- `sendTransaction` (semántica PENDING): https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction
- `getTransaction` y ventana de retención: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction
- Channel accounts: https://developers.stellar.org/docs/build/guides/transactions/channel-accounts
- Cambios a transaction submission (1 tx/cuenta/ledger): https://stellar.org/blog/developers/proposed-changes-to-transaction-submission
- Fees, surge pricing y límites: https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- Fee bump transactions explicadas: https://medium.com/stellar-community/fee-bump-transactions-explained-9a6a365c0fb6
