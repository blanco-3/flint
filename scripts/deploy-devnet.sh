#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export COREPACK_ENABLE_AUTO_PIN=0

DEVNET_URL="https://api.devnet.solana.com"
MIN_BALANCE_SOL="3"
ARTIFACTS_DIR="artifacts"
DEPLOY_JSON="$ARTIFACTS_DIR/devnet-deploy.json"
CONFIG_JSON="$ARTIFACTS_DIR/devnet-config.json"

mkdir -p "$ARTIFACTS_DIR" target/idl

current_balance="$(solana balance --url devnet | awk '{print $1}')"
python3 - "$current_balance" "$MIN_BALANCE_SOL" <<'PY'
import sys
balance = float(sys.argv[1])
minimum = float(sys.argv[2])
if balance < minimum:
    print(f"Insufficient devnet balance: {balance} SOL < {minimum} SOL", file=sys.stderr)
    sys.exit(1)
PY

./scripts/build.sh
cp idl/flint.json target/idl/flint.json
diff idl/flint.json target/idl/flint.json

deploy_output="$(anchor deploy --provider.cluster devnet 2>&1)"
printf '%s\n' "$deploy_output"

deploy_signature="$(printf '%s\n' "$deploy_output" | sed -n 's/^Signature: //p' | tail -n1)"
program_id="$(printf '%s\n' "$deploy_output" | sed -n 's/^Program Id: //p' | tail -n1)"

if [[ -z "$deploy_signature" || -z "$program_id" ]]; then
  echo "Failed to parse deploy output" >&2
  exit 1
fi

ANCHOR_PROVIDER_URL="$DEVNET_URL" \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
node scripts/init-config.js > "$CONFIG_JSON"

python3 - "$DEPLOY_JSON" "$program_id" "$deploy_signature" <<'PY'
import json
import sys

path, program_id, signature = sys.argv[1:4]
payload = {
    "cluster": "devnet",
    "programId": program_id,
    "deploySignature": signature,
    "programExplorer": f"https://explorer.solana.com/address/{program_id}?cluster=devnet",
    "deployExplorer": f"https://explorer.solana.com/tx/{signature}?cluster=devnet",
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
    fh.write("\n")
PY

echo "Wrote $DEPLOY_JSON and $CONFIG_JSON"
