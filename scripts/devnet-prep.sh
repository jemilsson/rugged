#!/usr/bin/env bash
# Idempotent devnet prep: generate deploy wallet + program keypair, airdrop
# devnet SOL, print addresses and balances.
#
# Preferred: nix shell nixpkgs#solana-cli -c scripts/devnet-prep.sh
#   solana-cli has no binary cache on this system and compiles from source
#   (20-40+ min). The build restarts from scratch on interruption, so a
#   plain re-run of the same command is fine, just slow; there is no
#   partial-build resume across separate `nix shell` invocations.
#
# Fallback (no Nix / build too slow): this script auto-detects a missing
# `solana-keygen`/`solana` and falls back to scripts/pysolkeygen.py, a
# pure-stdlib Ed25519 keygen (RFC 8032 reference algorithm, sign/verify
# round-trip tested) that writes the same 64-byte
# [seed(32) || pubkey(32)] JSON keyfile format solana-keygen uses, plus
# base58 pubkey printing. Airdrop and balance then go through direct
# JSON-RPC calls (curl) to https://api.devnet.solana.com instead of the
# `solana` CLI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keys_dir="$repo_root/keys"
deploy_wallet="$keys_dir/deploy-wallet.json"
program_keypair="$keys_dir/rugged-program-keypair.json"
py_fallback="$repo_root/scripts/pysolkeygen.py"
rpc_url="https://api.devnet.solana.com"

mkdir -p "$keys_dir"

have_cli=false
if command -v solana-keygen >/dev/null 2>&1 && command -v solana >/dev/null 2>&1; then
  have_cli=true
fi

gen_keypair() {
  local out="$1"
  if [ "$have_cli" = true ]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$out"
  else
    python3 "$py_fallback" new "$out" >/dev/null
  fi
}

pubkey_of() {
  local kf="$1"
  if [ "$have_cli" = true ]; then
    solana-keygen pubkey "$kf"
  else
    python3 "$py_fallback" pubkey "$kf"
  fi
}

rpc_call() {
  # $1 = json body
  curl -sS -X POST "$rpc_url" -H "Content-Type: application/json" -d "$1"
}

if [ ! -f "$deploy_wallet" ]; then
  gen_keypair "$deploy_wallet"
  echo "Generated deploy wallet: $deploy_wallet"
else
  echo "Deploy wallet already exists: $deploy_wallet"
fi

if [ ! -f "$program_keypair" ]; then
  gen_keypair "$program_keypair"
  echo "Generated program keypair: $program_keypair"
else
  echo "Program keypair already exists: $program_keypair"
fi

deploy_pubkey="$(pubkey_of "$deploy_wallet")"
program_id="$(pubkey_of "$program_keypair")"

echo "Deploy wallet pubkey: $deploy_pubkey"
echo "Program id:           $program_id"

airdrop_ok=false
for i in 1 2 3; do
  echo "Airdrop attempt $i/3 (2 SOL to $deploy_pubkey)..."
  if [ "$have_cli" = true ]; then
    if solana airdrop 2 "$deploy_pubkey" --url devnet; then
      airdrop_ok=true
      break
    fi
  else
    resp="$(rpc_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$deploy_pubkey\",2000000000]}")"
    echo "$resp"
    if echo "$resp" | grep -q '"result"'; then
      airdrop_ok=true
      break
    fi
  fi
  echo "Airdrop attempt $i failed, retrying..."
  sleep 5
done

if [ "$airdrop_ok" = false ]; then
  echo "Automated airdrop failed after 3 attempts (devnet faucet is often rate-limited)."
  echo "Fall back to the web faucet: https://faucet.solana.com"
  echo "  1. Paste pubkey: $deploy_pubkey"
  echo "  2. Select network: devnet"
  echo "  3. Request SOL, then re-run this script or check balance manually."
fi

echo "Balance for $deploy_pubkey:"
if [ "$have_cli" = true ]; then
  solana balance "$deploy_pubkey" --url devnet
else
  rpc_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$deploy_pubkey\"]}"
  echo
fi
