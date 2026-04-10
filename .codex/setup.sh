#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER_PATH="/tmp/flint-test-ledger-new"
VALIDATOR_URL="http://127.0.0.1:8899"
PROGRAM_ID="5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt"

healthcheck() {
  curl -sf "$VALIDATOR_URL" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' > /dev/null
}

if ! command -v rustup > /dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

if ! command -v solana > /dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export COREPACK_ENABLE_AUTO_PIN=0

cd "$REPO_ROOT"
yarn install

mkdir -p "$HOME/.config/solana"
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$HOME/.config/solana/id.json"
fi

if ! healthcheck; then
  solana-test-validator --ledger "$LEDGER_PATH" --quiet &
  for _ in $(seq 1 20); do
    if healthcheck; then
      break
    fi
    sleep 1
  done
fi

if ! healthcheck; then
  echo "Validator failed to start on $VALIDATOR_URL"
  exit 1
fi

export PATH="/Users/blanco/.cargo/bin:$PATH"
anchor build --no-idl

mkdir -p target/idl
cp idl/flint.json target/idl/flint.json

solana program deploy target/deploy/flint.so \
  --url "$VALIDATOR_URL" \
  --program-id "$PROGRAM_ID"
