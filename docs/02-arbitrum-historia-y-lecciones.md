# 02 · Cómo nació Arbitrum, cómo se presentó y qué copiamos

## 1. Línea de tiempo

| Año | Hito |
|---|---|
| 2014 | Ed Felten (profesor de Princeton, luego *Deputy CTO* de la Casa Blanca con Obama) empieza a pensar en ejecutar contratos **fuera de la cadena** con verificación en cadena. Primer prototipo académico en clase. |
| 2018 | Felten + dos doctorandos, **Steven Goldfeder** y **Harry Kalodner**, publican el paper *"Arbitrum: Scalable, private smart contracts"* (USENIX Security, agosto 2018; escrito en mayo). Licencian la tecnología de Princeton y fundan **Offchain Labs**. |
| 2019 | Seed de **3.7 M USD** liderado por Pantera. Lanzan una *alpha*: "un add-on para casi cualquier aplicación blockchain que la hace mejor". |
| may-2021 | Mainnet **beta para desarrolladores** (whitelist de proyectos). |
| 31-ago-2021 | **Arbitrum One abre al público** + Serie B de **120 M USD** (Lightspeed, Polychain, Pantera, Alameda, Mark Cuban). Reddit elige Arbitrum en su "Great Reddit Scaling Bake-off". |
| 2022 | Migración a **Nitro** (WASM + Geth: el nodo es Ethereum casi sin cambios compilado a WASM para las pruebas de fraude). |
| 2023 | Token **ARB** y DAO (gobernanza, no gas: el gas sigue pagándose en ETH). |
| 2024 | **Stylus**: contratos en Rust/C/C++ compilados a WASM conviviendo con la EVM. De ahí sale el famoso "Doom corriendo en un smart contract": alguien compiló el motor de Doom a WASM y lo ejecutó dentro de Stylus en una hackathon. **Nota para nosotros: Soroban también es WASM (Rust).** Lo que Arbitrum tuvo que añadir con Stylus, Stellar lo tiene nativo. |

## 2. Qué es técnicamente Arbitrum (en 6 líneas)

1. Los usuarios envían transacciones a un **secuenciador** (operado por Offchain Labs, centralizado hasta hoy) que las ordena y da confirmación en ~250 ms.
2. El secuenciador publica **lotes** con los datos crudos de las transacciones en Ethereum (calldata/blobs) → *data availability* en L1.
3. Los **validadores** ejecutan esos datos y publican **afirmaciones** del estado (raíz).
4. Si alguien no está de acuerdo, hay un **periodo de desafío** (~7 días) donde un solo validador honesto puede probar el fraude on-chain (*optimistic rollup*).
5. Los fondos viven en contratos en L1 (Bridge/Inbox/Outbox); los retiros se reclaman en L1 con prueba Merkle contra el estado confirmado.
6. Hay **inclusión forzada**: si el secuenciador censura, el usuario mete su tx por L1 y tras 24 h debe ser incluida.

## 3. Cómo se **presentó** (la parte de marketing/producto)

- **"Drop-in replacement"**: *"People who are familiar with Ethereum will just put in a different node address and talk to Arbitrum instead. That compatibility is super important."* (Felten). Mismo tooling, mismos contratos, misma wallet. Cero fricción para el dev.
- **Seguridad heredada de la L1**: *"Arbitrum instantly scales apps, reducing costs and increasing capacity, without sacrificing Ethereum's security."* Nunca vendieron "otra blockchain"; vendieron *Ethereum, pero rápido*.
- **Se lanzó primero para devs, luego para usuarios**: beta con proyectos ancla (Uniswap, Sushi, etc.) → apertura pública ya con liquidez y apps.
- **Fair launch**: sin token al principio; el ecosistema se construyó sobre ETH. El token vino 18 meses después, para gobernanza.
- **Credibilidad académica**: paper peer-reviewed + Princeton + ex Casa Blanca. Confianza antes que hype.

## 4. Lo que Arbitrum tenía que Stellar Flash **ya tiene o tiene más fácil**

| Arbitrum tuvo que… | En Stellar |
|---|---|
| Construir una VM propia (AVM) y después Nitro para tener WASM verificable | Soroban **es** WASM. El estado de Flash se puede hashear con SHA-256 hoy y con **Poseidon2** (host function nativa desde Protocolo 25) mañana para ZK. |
| Esperar a EIP-4844 (blobs) para abaratar data availability | Una tx Soroban acepta hasta **132 KB** de datos a 406 stroops/KB (~0.005 XLM por lote lleno). |
| Verificar pruebas ZK con precompiles BN254 de Ethereum | Stellar añadió **BN254 (CAP-74) y Poseidon (CAP-75)** en Protocolo 25 (X-Ray, 22-ene-2026) precisamente "para hacer posible lógica de rollups L2". Hay verificadores Groth16/UltraHonk en Soroban funcionando en testnet. |
| Convencer a wallets de soportar otra red | Flash usa **las mismas llaves ed25519** (direcciones `G...`) y los mismos activos (XLM, USDC vía SAC). No hay "cambiar de red" en la wallet. |
| Competir con 10 rollups | **No existe ningún rollup en producción sobre Stellar** (solo payment channels: Starlight, MPP). Ventana abierta. |

## 5. Lecciones que aplicamos (decisiones de diseño)

1. **Secuenciador único al inicio, seguridad en el contrato.** Arbitrum One lleva 5 años con secuenciador centralizado y gestiona miles de millones porque los fondos no dependen de él. Flash v0 hace lo mismo: `withdraw` con prueba Merkle, `escape`, `reclaim_deposit`.
2. **Datos en L1 desde el día uno.** `commit_batch` recibe los bytes del lote; el contrato guarda el hash y los bytes quedan en el historial de Stellar. Cualquiera reconstruye el estado (`replayBatch`).
3. **Optimista primero, ZK después.** Arbitrum sigue siendo optimista y funciona. Flash v0 es optimista con periodo de desafío; la fase ZK (pruebas de validez con BN254/Poseidon2) elimina el periodo de espera para retiros.
4. **Empezar por pagos, no por cómputo general.** Fuel v1, Loopring y zkSync Lite empezaron como rollups **solo de pagos** porque la máquina de estado es trivial y las pruebas de fraude/validez son simples. El 90 % del dolor en Stellar son pagos. Cómputo general (ejecutar contratos Soroban dentro de Flash) es fase 3.
5. **Vender "Stellar, pero instantáneo"**, no "otra cadena". El pitch de Flash es: *tus usuarios, tus tokens, tus llaves, tus contratos… con confirmación en milisegundos y sin depender de que la RPC pública esté bien.*
6. **Devs primero.** El producto inicial es un SDK que reemplaza `submitTransaction` por `flash.transfer` + un panel para ver lotes y salud L1. Los usuarios finales ni deben saber que existe Flash.

## 6. Fuentes

- Princeton Office of Innovation, "Offchain Labs: Growing the capacity of blockchain solutions" (2021): https://innovation.princeton.edu/news/2021/offchain-labs-growing-capacity-blockchain-solutions
- PR Newswire, lanzamiento público de Arbitrum One + 120 M USD (31-ago-2021): https://www.prnewswire.com/news-releases/offchain-labs-rolls-out-arbitrum-one-ethereum-scaling-solution-to-the-public-and-announces-120m-in-funding-301365642.html
- NJ Tech Weekly, seed de 3.7 M USD y origen del paper: https://njtechweekly.com/princeton-startup-offchain-labs-speeds-secures-blockchain-application-development/
- Historia oficial: https://www.offchain.io/arbitrum
- Protocolo 25 X-Ray (BN254 + Poseidon): https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25
- ZK en Stellar (docs): https://developers.stellar.org/docs/build/apps/zk
