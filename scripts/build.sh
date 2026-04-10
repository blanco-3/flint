#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="/Users/blanco/.cargo/bin:$PATH"

echo "Building Flint program..."
anchor build --no-idl

mkdir -p target/idl
cp idl/flint.json target/idl/flint.json
diff idl/flint.json target/idl/flint.json

echo "Build successful."
