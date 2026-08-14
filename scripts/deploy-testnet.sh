#!/usr/bin/env bash
#
# Deploys the Corpuslane contract to a Soroban network (testnet by default)
# and prints the resulting contract id.
#
# Prerequisites:
#   - cargo + the wasm32v1-none Rust target installed
#   - the `stellar` CLI v21+ (https://github.com/stellar/stellar-cli)
#   - a funded account on the target network
#
# Usage:
#   export DEPLOYER_SECRET=SB…            # secret key of the deployer
#   export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
#   export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
#   ./scripts/deploy-testnet.sh
#
# After the deploy finishes, set:
#   backend/.env     CONTRACT_ID=<printed id>
#   frontend/.env.local  NEXT_PUBLIC_CONTRACT_ID=<printed id>
#
# Validated against testnet on 2026-08-14 with stellar-cli v27.1.0.

set -euo pipefail

cd "$(dirname "$0")/../contract"

DEPLOYER_SECRET="${DEPLOYER_SECRET:-}"
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org:443}"
SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

if [[ -z "$DEPLOYER_SECRET" ]]; then
  echo "error: DEPLOYER_SECRET is required (funded account secret key)" >&2
  exit 1
fi
if ! command -v stellar >/dev/null 2>&1; then
  echo "error: 'stellar' CLI not found. Install from https://github.com/stellar/stellar-cli" >&2
  exit 1
fi

echo ">> Building wasm (wasm32v1-none)…"
cargo build-wasm

WASM="target/wasm32v1-none/release/corpuslane.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "error: expected wasm at $WASM" >&2
  exit 1
fi

echo ">> Deploying contract…"
CONTRACT_ID="$(
  stellar contract deploy \
    --wasm "$WASM" \
    --source "$DEPLOYER_SECRET" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE"
)"

echo ""
echo "Contract deployed: $CONTRACT_ID"
echo ""
echo "Next steps:"
echo "  1. backend/.env           CONTRACT_ID=$CONTRACT_ID"
echo "  2. frontend/.env.local    NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
echo "  3. start the stack (see DEPLOYMENT.md)"
echo ""
echo "On testnet it can help to fund the contract account once:"
echo "  stellar contract id asset <wasm-hash>  # or use a friendly builder"
echo "See DEPLOYMENT.md for production setup and ledger-restore guidance."
