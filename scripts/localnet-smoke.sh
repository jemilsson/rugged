#!/usr/bin/env bash
# Localnet smoke test for the rugged program.
#
# Starts a fresh solana-test-validator, deploys the built program, and runs
# scripts/localnet-smoke.ts against it to exercise initialize_game / join x2
# / assign_roles end to end.
#
# Requires the Solana CLI (solana, solana-test-validator) and, to produce
# the artifacts this script deploys, the Anchor CLI. Neither is packaged in
# this repo's flake devShell (see flake.nix shellHook); pull the Solana CLI
# from nixpkgs and the Anchor CLI separately per README, e.g.:
#
#   nix shell nixpkgs#solana-cli nixpkgs#nodejs_22 -c ./scripts/localnet-smoke.sh
#
# with anchor (avm) already on PATH to have built target/deploy/rugged.so
# and target/idl/rugged.json beforehand (anchor build).
#
# Build step this script expects to have already run:
#
#   anchor build
#
# which populates target/deploy/rugged.so and target/idl/rugged.json.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SO_PATH="target/deploy/rugged.so"
IDL_PATH="target/idl/rugged.json"
RPC_URL="http://127.0.0.1:8899"

LEDGER_DIR="$(mktemp -d)"
VALIDATOR_LOG="$LEDGER_DIR/validator.log"
VALIDATOR_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "==> tearing down solana-test-validator (pid $VALIDATOR_PID)"
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  rm -rf "$LEDGER_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

command -v solana-test-validator >/dev/null 2>&1 || {
  echo "FATAL: solana-test-validator not found on PATH." >&2
  echo "Install the Solana CLI (e.g. via the Agave installer) and retry." >&2
  exit 1
}

echo "==> starting solana-test-validator (ledger: $LEDGER_DIR)"
solana-test-validator -r --ledger "$LEDGER_DIR" --quiet >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

echo "==> waiting for validator health at $RPC_URL"
HEALTHY=0
for _ in $(seq 1 120); do
  if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "FATAL: solana-test-validator exited before becoming healthy. Log:" >&2
    cat "$VALIDATOR_LOG" >&2
    exit 1
  fi
  if curl -s -o /dev/null -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      "$RPC_URL" 2>/dev/null | grep -q '^200$'; then
    HEALTHY=1
    break
  fi
  sleep 0.5
done

if [[ "$HEALTHY" -ne 1 ]]; then
  echo "FATAL: solana-test-validator did not become healthy in time. Log:" >&2
  cat "$VALIDATOR_LOG" >&2
  exit 1
fi
echo "==> validator healthy"

if [[ ! -f "$SO_PATH" ]]; then
  echo "FATAL: $SO_PATH not found." >&2
  echo "Build the program first:" >&2
  echo "    anchor build" >&2
  exit 1
fi

echo "==> deploying $SO_PATH"
solana program deploy "$SO_PATH" --url "$RPC_URL" --commitment confirmed

if [[ ! -f "$IDL_PATH" ]]; then
  echo "FATAL: IDL not found at $IDL_PATH." >&2
  echo "Build the program first (anchor build generates the IDL alongside the .so)." >&2
  exit 1
fi

echo "==> running localnet-smoke.ts"
RUGGED_RPC_URL="$RPC_URL" RUGGED_IDL_PATH="$REPO_ROOT/$IDL_PATH" \
  npx tsx "$REPO_ROOT/scripts/localnet-smoke.ts"

echo "==> smoke test passed"
