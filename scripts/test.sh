#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="/Users/blanco/.cargo/bin:$PATH"
export COREPACK_ENABLE_AUTO_PIN=0

if ! curl -sf http://127.0.0.1:8899 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' > /dev/null; then
  echo "ERROR: solana-test-validator not running on 8899"
  echo "Run: solana-test-validator --ledger /tmp/flint-test-ledger-new --quiet &"
  exit 1
fi

mkdir -p target/idl
cp idl/flint.json target/idl/flint.json
diff idl/flint.json target/idl/flint.json

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
