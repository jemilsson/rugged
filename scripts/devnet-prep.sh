#!/usr/bin/env bash
# Idempotent devnet prep: generate deploy wallet + program keypair, airdrop
# devnet SOL, print addresses and balances.
#
# Run via Nix: nix shell nixpkgs#solana-cli -c scripts/devnet-prep.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keys_dir="$repo_root/keys"
deploy_wallet="$keys_dir/deploy-wallet.json"
program_keypair="$keys_dir/rugged-program-keypair.json"

mkdir -p "$keys_dir"

if [ ! -f "$deploy_wallet" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$deploy_wallet"
  echo "Generated deploy wallet: $deploy_wallet"
else
  echo "Deploy wallet already exists: $deploy_wallet"
fi

if [ ! -f "$program_keypair" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$program_keypair"
  echo "Generated program keypair: $program_keypair"
else
  echo "Program keypair already exists: $program_keypair"
fi

deploy_pubkey="$(solana-keygen pubkey "$deploy_wallet")"
program_id="$(solana-keygen pubkey "$program_keypair")"

echo "Deploy wallet pubkey: $deploy_pubkey"
echo "Program id:           $program_id"

airdrop_ok=false
for i in 1 2 3; do
  echo "Airdrop attempt $i/3 (2 SOL to $deploy_pubkey)..."
  if solana airdrop 2 "$deploy_pubkey" --url devnet; then
    airdrop_ok=true
    break
  fi
  echo "Airdrop attempt $i failed, retrying..."
  sleep 5
done

if [ "$airdrop_ok" = false ]; then
  echo "Automated airdrop failed after 3 attempts (devnet faucet is often rate-limited)."
  echo "Fall back to the web faucet: https://faucet.solana.com"
  echo "  1. Paste pubkey: $deploy_pubkey"
  echo "  2. Select network: devnet"
  echo "  3. Request SOL, then re-run this script or 'solana balance $deploy_pubkey --url devnet'"
fi

echo "Balance for $deploy_pubkey:"
solana balance "$deploy_pubkey" --url devnet
