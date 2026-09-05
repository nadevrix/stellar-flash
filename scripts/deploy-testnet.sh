#!/usr/bin/env bash
# Despliega flash-bridge en Stellar TESTNET y deja un .env listo para correr el secuenciador en modo rpc.
#
# Requisitos: stellar-cli (https://github.com/stellar/stellar-cli/releases; o `cargo install --locked stellar-cli`),
#             cargo con target wasm32v1-none, node >= 22.18, curl.
# Uso:        bash scripts/deploy-testnet.sh
#
# Qué hace:
#  1. Genera (o reutiliza de .env) la cuenta SECUENCIADORA (admin + sequencer del contrato) y una cuenta de USUARIO de prueba.
#  2. Las fondea con Friendbot (XLM de testnet, sin valor).
#  3. Compila el contrato y lo despliega con constructor (challenge 20 ledgers ≈ 2 min, liveness 120 ledgers ≈ 10 min).
#  4. Hace un depósito de prueba de 10 XLM del usuario al puente (para que el secuenciador tenga algo que acreditar).
#  5. Escribe .env con L1_MODE=rpc, BRIDGE_CONTRACT_ID, SEQUENCER_SECRET, DEPOSIT_SCAN_START_LEDGER.
set -euo pipefail
cd "$(dirname "$0")/.."

STELLAR="${STELLAR_CLI:-stellar}"
command -v "$STELLAR" >/dev/null || { echo "stellar-cli no encontrado (exporta STELLAR_CLI=/ruta/a/stellar)"; exit 1; }
NETWORK=testnet
PASSPHRASE="Test SDF Network ; September 2015"
RPC="https://soroban-testnet.stellar.org"

# --- 1. llaves -------------------------------------------------------------------------------
if [[ -f .env ]] && grep -q '^SEQUENCER_SECRET=S' .env; then
  SEQ_SEC=$(grep '^SEQUENCER_SECRET=' .env | cut -d= -f2)
  echo "reutilizando SEQUENCER_SECRET de .env"
else
  SEQ_SEC=$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())")
fi
SEQ_PUB=$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.fromSecret('$SEQ_SEC').publicKey())")
USER_SEC=$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())")
USER_PUB=$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.fromSecret('$USER_SEC').publicKey())")
echo "secuenciador/admin: $SEQ_PUB"
echo "usuario de prueba:  $USER_PUB"

# --- 2. friendbot ----------------------------------------------------------------------------
for A in "$SEQ_PUB" "$USER_PUB"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://friendbot.stellar.org?addr=$A")
  echo "friendbot $A → HTTP $code (400 = ya fondeada, ok)"
done

# --- 3. build + deploy -----------------------------------------------------------------------
( cd contracts && cargo build --target wasm32v1-none --release -p flash-bridge --target-dir target )
WASM=contracts/target/wasm32v1-none/release/flash_bridge.wasm
echo "desplegando $WASM ..."
BRIDGE=$("$STELLAR" contract deploy --wasm "$WASM" --source "$SEQ_SEC" --network $NETWORK \
  -- --admin "$SEQ_PUB" --sequencer "$SEQ_PUB" --challenge_period_ledgers 20 --liveness_timeout_ledgers 120 | tail -1)
echo "BRIDGE_CONTRACT_ID=$BRIDGE"
XLM_SAC=$("$STELLAR" contract id asset --asset native --network $NETWORK | tail -1)
echo "XLM SAC (testnet): $XLM_SAC"
# Nota: la respuesta de getLatestLedger supera los 4 KB (metadataXdr), así que llega en varios chunks:
# hay que acumular stdin antes de parsear (bug corregido en la Fase 0, ver BITACORA).
START_LEDGER=$(curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).result.sequence-5))")

# --- 4. depósito de prueba (10 XLM = 100_000_000 stroops) --------------------------------------
echo "depósito de prueba de 10 XLM ..."
"$STELLAR" contract invoke --id "$BRIDGE" --source "$USER_SEC" --network $NETWORK -- deposit \
  --from "$USER_PUB" --token "$XLM_SAC" --amount 100000000 --l2_recipient "$USER_PUB"

# --- 5. .env -----------------------------------------------------------------------------------
# La passphrase lleva espacios y un ';': sin comillas, `set -a; source .env` la parte y el
# secuenciador arranca con otra red. Se escribe entrecomillada.
cat > .env <<EOF
L1_MODE=rpc
NETWORK_PASSPHRASE="$PASSPHRASE"
RPC_URLS=$RPC
BRIDGE_CONTRACT_ID=$BRIDGE
SEQUENCER_SECRET=$SEQ_SEC
ALLOWED_TOKENS=$XLM_SAC
DB_PATH=data/flash-testnet.db
API_HOST=127.0.0.1
API_PORT=8787
CHALLENGE_PERIOD_LEDGERS=20
DEPOSIT_SCAN_START_LEDGER=$START_LEDGER
# usuario de prueba (ya tiene 10 XLM depositados en Flash)
TEST_USER_SECRET=$USER_SEC
EOF
echo
echo "listo. Arranca el secuenciador con:  set -a; source .env; set +a; node sequencer/src/index.ts"
echo "y en otra terminal:                  curl -s localhost:8787/v1/accounts/$USER_PUB | jq"
echo "explorer del contrato:               https://stellar.expert/explorer/testnet/contract/$BRIDGE"
