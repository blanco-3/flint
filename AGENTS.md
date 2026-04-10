# Flint — Codex Agent Instructions

## Build

```bash
export PATH="/Users/blanco/.cargo/bin:$PATH"
anchor build --no-idl
```

Do not run `anchor build` without `--no-idl`. `anchor-syn 0.30.1` is not compatible with the current IDL-generation path in this environment, so plain `anchor build` can fail for reasons unrelated to the program logic.

## Test

```bash
export PATH="/Users/blanco/.cargo/bin:$PATH"
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

Do not run `anchor test`. It tries to manage its own validator lifecycle and collides with the externally managed validator on port `8899`.

`scripts/test.sh` upgrades the current build to the local validator before running tests so new instructions are available on-chain.

The validator is expected to be started separately:

```bash
solana-test-validator --ledger /tmp/flint-test-ledger-new --quiet
```

## IDL Sync

- `idl/flint.json` is the only tracked source of truth.
- `target/idl/flint.json` is a generated mirror used by the harness and tests.
- Every build/test path must sync `idl/flint.json` into `target/idl/flint.json` first.

## Discriminator Calculation

Instruction discriminator:

```python
import hashlib
name = "instruction_name"  # snake_case
list(hashlib.sha256(f"global:{name}".encode()).digest()[:8])
```

Account discriminator:

```python
import hashlib
name = "AccountName"  # PascalCase
list(hashlib.sha256(f"account:{name}".encode()).digest()[:8])
```

## Error Code Rules

- When adding a new `errors.rs` variant, update the IDL `errors` array in `idl/flint.json` too.
- Error codes are sequential starting at `6000`.
- Current last error code: `6016` (`RefundGracePeriodNotElapsed`).

## PDA Seeds

- `IntentAccount`: `[b"intent", user_pubkey, nonce_le_8bytes]`
- `BidAccount`: `[b"bid", intent_pubkey, solver_pubkey]`
- `SolverRegistryAccount`: `[b"solver", solver_pubkey]`

## Borrow / Signing Note

Preserve the `settle_auction` signer-seed pattern:

```rust
let nonce_bytes = ctx.accounts.intent.nonce.to_le_bytes();
let seeds = &[
    b"intent" as &[u8],
    ctx.accounts.intent.user.as_ref(),
    &nonce_bytes,
    &[bump],
];
```

Because of NLL / borrow-checker interactions, keep the mutable `intent` borrow after the signer seeds are no longer needed.

## DO NOT

- `anchor build` (without `--no-idl`)
- `anchor test`
- `anchor idl build`
- edit only one of the IDL locations used by the harness
- add an error variant without updating the tracked IDL errors array
- check `IntentStatus::Filled` inside `slash_solver`
- change TypeScript tests without verifying the Rust build too

## MUST for Every PR

- run `scripts/build.sh`
- run `scripts/test.sh`
- run `diff idl/flint.json target/idl/flint.json`
- `git add -A && git commit ... && git push origin main`
