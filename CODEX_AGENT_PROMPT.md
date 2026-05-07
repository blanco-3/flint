# Flint — Codex Agent Master Prompt
# Long-term Development & Production Hardening

## ROLE

You are a senior Solana/Rust engineer working on **Flint**, an on-chain intent auction protocol built with Anchor 0.30.1 on Solana. Your job is to systematically fix bugs, improve security, add missing features, and push the project toward mainnet production quality. Work through tasks in strict priority order. After completing each task, run the test suite and confirm it passes before moving on.

---

## PROJECT CONTEXT

**What Flint is:**
Flint is a protected execution backend for wallets, apps, bots, and agentic systems on Solana. Users submit swap intents (locking input tokens in escrow), registered solvers compete by submitting bids within a 20-slot auction window, and the winning solver settles atomically. On-chain slashing, timeout recovery, and rent-return paths keep the lifecycle safe even when execution fails.

**Program ID:** `5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt`
**Network:** Devnet deployed. Localnet for development.

**Repo layout:**
```
flint/
├── programs/flint/src/
│   ├── lib.rs                        # Anchor entry point, 10 instructions
│   ├── errors.rs                     # FlintError enum
│   ├── state/
│   │   ├── intent.rs                 # IntentAccount, IntentStatus, AUCTION_WINDOW_SLOTS=20, REFUND_GRACE_SLOTS=10
│   │   ├── bid.rs                    # BidAccount
│   │   ├── registry.rs               # SolverRegistryAccount, MIN_STAKE_LAMPORTS=0.1SOL, SLASH_BPS=2000
│   │   └── config.rs                 # ConfigAccount (admin, slash_authority, stake_lockup_slots)
│   └── instructions/
│       ├── submit_intent.rs          # User submits intent, tokens go to escrow ATA
│       ├── submit_bid.rs             # Solver bids; outbid handling via optional accounts
│       ├── settle_auction.rs         # Atomic swap: escrow→solver, solver output→user; closes escrow+intent+bid
│       ├── register_solver.rs        # Deposits SOL stake into SolverRegistryAccount PDA
│       ├── cancel_intent.rs          # No-bid timeout: refund escrow, close accounts
│       ├── refund_after_timeout.rs   # Winning-bid timeout: refund + 20% slash + close accounts
│       ├── slash_solver.rs           # Authority-gated slash (does NOT currently close intent or refund)
│       ├── withdraw_stake.rs         # Solver withdraws stake after lockup, closes registry PDA
│       ├── initialize_config.rs      # Creates singleton ConfigAccount PDA (seeds=[b"config"])
│       └── update_slash_authority.rs # Admin rotates slash authority
├── solver-bot/src/
│   ├── main.rs                       # CLI: run / status / settle / refund subcommands
│   ├── monitor.rs                    # Polls open IntentAccounts via getProgramAccounts
│   ├── executor.rs                   # Builds + sends place_bid, settle_auction, refund_after_timeout txs
│   └── strategies/
│       ├── naive.rs                  # Returns min_output_amount + 1
│       └── jupiter.rs                # Fetches Jupiter /swap/v1/quote, applies spread_bps discount
├── relay/
│   ├── server.js                     # Node.js HTTP relay: /quote-request /solver/quote /execute /status/:id
│   ├── store.js                      # In-memory + file-backed request store
│   ├── notifier.js                   # Webhook delivery
│   └── openapi.json                  # OpenAPI spec
├── sdk/
│   ├── flint-relay-client.ts         # TypeScript client for relay API
│   └── flint-guard-safety-feed.ts    # Safety feed types + client
├── flint-console/                    # Vite/React operator console
│   └── src/
│       ├── App.tsx
│       └── lib/                      # Seeded demo mode + live API mode
├── tests/flint.ts                    # Anchor TypeScript tests (829 lines, mocha)
├── scripts/
│   ├── demo.js                       # Local happy/timeout demo
│   ├── benchmark.js                  # Throughput benchmark
│   ├── devnet-smoke.js               # Devnet smoke (happy + timeout)
│   ├── deploy-devnet.sh
│   └── build.sh / test.sh
├── docs/
│   ├── b2b-integration.md
│   ├── market-positioning.md
│   ├── operator-runbook.md
│   └── request-state-diagram.md
└── artifacts/                        # benchmark-local.json, judge-guide.md, smoke artifacts, scorecard
```

**Build command:**
```bash
export PATH="$HOME/.cargo/bin:$PATH"
./scripts/build.sh          # anchor build --no-idl
./scripts/test.sh           # ts-mocha against localnet
```

**Key constants:**
- `AUCTION_WINDOW_SLOTS = 20` (~8 seconds)
- `REFUND_GRACE_SLOTS = 10`
- `MIN_STAKE_LAMPORTS = 100_000_000` (0.1 SOL)
- `SLASH_BPS = 2000` (20%)

---

## TASK LIST — ORDERED BY PRIORITY

Work through every task below. Mark each one complete (by leaving a comment or creating a git commit) before starting the next. Run `./scripts/test.sh` after each task that modifies on-chain code or tests.

---

### PHASE 1 — CRITICAL BUG FIXES (do these first, no exceptions)

---

#### TASK 1: Fix double-slash vulnerability in `slash_solver`

**File:** `programs/flint/src/instructions/slash_solver.rs`

**Bug:** `slash_solver` deducts 20% stake from the solver but does **not** update `intent.status`. Because `refund_after_timeout` also requires `intent.status == IntentStatus::Open`, both instructions can be called in sequence on the same intent, causing the solver to be slashed twice (40% total) and the escrow to be refunded as a bonus on top.

**Fix:**
1. Add `intent` as a `mut` account in `SlashSolver` accounts struct (it is currently read-only).
2. At the end of the handler, after the lamport transfer, set `intent.status = IntentStatus::Expired`.
3. Add a `close = user` constraint on `intent` in `SlashSolver` so the account rent is returned — OR — if you prefer to keep the account open for audit purposes, do NOT add `close` but DO set the status to `Expired` so `refund_after_timeout` can no longer be called.
4. Also add `winning_bid` as a `mut` account with `close = solver` (same pattern as `refund_after_timeout`) so the BidAccount rent is not stranded.
5. Add `user: SystemAccount<'info>` as the rent destination for `intent`.
6. Add a new error `FlintError::IntentAlreadyFinalised` and use it as a guard at the top of both `slash_solver` and `refund_after_timeout`: `require!(intent.status == IntentStatus::Open, FlintError::IntentAlreadyFinalised)`.
7. Update `errors.rs` with the new variant.
8. Add a test case in `tests/flint.ts`: call `slash_solver`, then attempt `refund_after_timeout` on the same intent, and assert that the second call fails with `IntentAlreadyFinalised`.

---

#### TASK 2: Close outbid BidAccount on outbid to recover solver rent

**File:** `programs/flint/src/instructions/submit_bid.rs`

**Bug:** When solver B outbids solver A, the handler decrements `previous_solver_registry.active_winning_bids` but never closes solver A's `BidAccount`. Solver A's rent (~0.002 SOL) is permanently locked in the now-abandoned account.

**Fix:**
1. In `SubmitBid` accounts struct, add a `close` constraint to `previous_winning_bid`:
   ```rust
   #[account(
       mut,
       close = previous_solver,   // rent returns to the outbid solver
   )]
   pub previous_winning_bid: Option<Account<'info, BidAccount>>,
   ```
2. Add `previous_solver: Option<SystemAccount<'info>>` to the accounts struct. This is the pubkey of the solver who owns the previous bid. Derive it from `previous_winning_bid.solver` and verify with a constraint:
   ```rust
   constraint = previous_solver.as_ref().map(|s| s.key()) == previous_winning_bid.as_ref().map(|b| b.solver) @ FlintError::PreviousWinningBidMismatch
   ```
3. The `close` attribute on an `Option<Account>` only triggers when the Option is `Some`. Verify this works as expected in Anchor 0.30.1 — if not, handle it manually in the handler body using `if let Some(prev_bid) = &ctx.accounts.previous_winning_bid`.
4. Update the TypeScript tests to pass the `previousSolver` account when outbidding, and add an assertion that the old BidAccount is closed after the outbid.

---

#### TASK 3: Prevent self-bidding (user bids on their own intent)

**File:** `programs/flint/src/instructions/submit_bid.rs`

**Bug:** There is no check that `solver != intent.user`. A user could submit an intent, immediately bid on it themselves, then settle — effectively bypassing escrow and paying no protocol fee.

**Fix:**
1. Add at the top of the handler:
   ```rust
   require_keys_neq!(
       ctx.accounts.solver.key(),
       ctx.accounts.intent.user,
       FlintError::SolverCannotBeIntentUser
   );
   ```
2. Add `FlintError::SolverCannotBeIntentUser` to `errors.rs` with message `"Solver cannot be the same account as the intent user"`.
3. Add a test case that creates an intent and attempts to bid on it with the same keypair, asserting the error.

---

### PHASE 2 — SECURITY HARDENING

---

#### TASK 4: Add emergency pause to ConfigAccount

**Files:** `programs/flint/src/state/config.rs`, `programs/flint/src/instructions/`, `programs/flint/src/lib.rs`

**Why:** The operator runbook references an emergency pause gate but it is not implemented. Without it, a discovered vulnerability cannot be halted on-chain.

**Implementation:**
1. Add `pub is_paused: bool` field to `ConfigAccount` struct. Update `INIT_SPACE` accordingly.
2. Create `programs/flint/src/instructions/set_pause.rs`:
   - Instruction: `set_pause(ctx, paused: bool)`
   - Accounts: `admin: Signer`, `config: Account<ConfigAccount>` with `constraint = config.admin == admin.key()`
   - Sets `config.is_paused = paused`
   - Emits `PauseStateChanged { paused, admin }`
3. Add a `check_not_paused` macro or free function:
   ```rust
   macro_rules! check_not_paused {
       ($config:expr) => {
           require!(!$config.is_paused, FlintError::ProtocolPaused)
       };
   }
   ```
4. Add `FlintError::ProtocolPaused` to `errors.rs`.
5. Add `check_not_paused!(ctx.accounts.config)` at the top of handlers for: `submit_intent`, `submit_bid`, `settle_auction`, `register_solver`. (Recovery instructions `cancel_intent`, `refund_after_timeout` should remain callable even when paused so users can get funds back.)
6. Pass `config` as an additional account to affected instructions. Use `seeds = [b"config"], bump = config.bump` — read-only, no `mut` needed.
7. Register `set_pause` in `lib.rs` and `instructions/mod.rs`.
8. Add tests: pause → attempt submit_intent → assert ProtocolPaused. Unpause → submit_intent succeeds.

---

#### TASK 5: Implement commit-reveal sealed-bid auction

**Why:** The current implementation uses open on-chain bids. Any solver (or MEV bot) monitoring the chain can see the current best bid and submit `best_bid + 1` at the last slot, providing zero price improvement. Sealed-bid forces solvers to commit to a price without seeing competitors' bids.

**Design:**

Phase 1 — Commit (during auction window):
- Solver submits `commitment = keccak256(output_amount || salt || solver_pubkey)` on-chain.
- `BidAccount` stores: `commitment: [u8; 32]`, `output_amount: 0` (hidden), `is_revealed: bool`.
- `submit_bid` stores only the commitment. No `best_bid_amount` update yet.

Phase 2 — Reveal (after `close_at_slot`, before `close_at_slot + REVEAL_WINDOW_SLOTS`):
- Add new instruction `reveal_bid(output_amount: u64, salt: u64)`.
- Verify `keccak256(output_amount || salt || solver.key()) == bid.commitment`.
- Update `intent.best_bid_amount` if this is the new highest revealed bid.
- Set `bid.output_amount = output_amount`, `bid.is_revealed = true`.

Phase 3 — Settle (after reveal window):
- `settle_auction` checks `current_slot > close_at_slot + REVEAL_WINDOW_SLOTS`.
- Only operates on the bid with `is_revealed == true` and highest `output_amount`.

**New constants to add in `state/intent.rs`:**
```rust
pub const COMMIT_WINDOW_SLOTS: u64 = 20;  // same as AUCTION_WINDOW_SLOTS
pub const REVEAL_WINDOW_SLOTS: u64 = 10;   // after close_at_slot
```

**New fields to add to `BidAccount`:**
```rust
pub commitment: [u8; 32],
pub is_revealed: bool,
```

**New instruction:** `reveal_bid`
**Modified instructions:** `submit_bid` (store commitment only), `settle_auction` (check reveal window + is_revealed)

**Keccak in Anchor/Solana:**
Use `anchor_lang::solana_program::keccak::hash()` to compute the hash on-chain during reveal to verify the commitment.

**Update all affected tests** to use the two-phase flow: commit → wait for auction close → reveal → settle.

---

#### TASK 6: Add protocol fee to `settle_auction`

**Why:** There is no revenue model. A protocol fee makes Flint economically sustainable and is standard for intent/RFQ protocols.

**Design:**
1. Add to `ConfigAccount`:
   ```rust
   pub protocol_fee_bps: u16,      // e.g. 10 = 0.10%
   pub protocol_fee_recipient: Pubkey,
   ```
2. Add instruction `update_fee_config(fee_bps: u16, recipient: Pubkey)` gated by `config.admin`.
3. In `settle_auction` handler, after the solver→user output transfer:
   - Compute `fee = output_amount * protocol_fee_bps / 10_000`
   - Transfer `fee` lamports (or tokens, depending on output_mint) from solver to `protocol_fee_recipient`
   - Transfer `output_amount - fee` to user
4. Add `protocol_fee_recipient: SystemAccount<'info>` to `SettleAuction` accounts.
5. Add `FlintError::FeeBpsTooHigh` — reject if `fee_bps > 100` (max 1%).
6. Add tests: settle with non-zero fee, verify recipient receives correct amount and user receives `output - fee`.

---

### PHASE 3 — MISSING FEATURES

---

#### TASK 7: Solver reputation scoring — make it functional

**File:** `programs/flint/src/state/registry.rs`, `settle_auction.rs`, `refund_after_timeout.rs`

**Current state:** `reputation_score` is initialised to `1000` and decremented by `100` on slash, but never increases on successful fills.

**Fix:**
1. In `settle_auction` handler, after updating `total_fills`, update reputation:
   ```rust
   // score = (total_fills * 1000) / total_bids, clamped to [0, 1000]
   if solver_registry.total_bids > 0 {
       solver_registry.reputation_score = (solver_registry.total_fills
           .saturating_mul(1000))
           .checked_div(solver_registry.total_bids)
           .unwrap_or(0)
           .min(1000);
   }
   ```
2. Add `min_reputation_score: u64` to `ConfigAccount` (default `0`). Add `update_fee_config` or a separate `update_min_reputation` instruction.
3. In `submit_bid`, add:
   ```rust
   require!(
       ctx.accounts.solver_registry.reputation_score >= ctx.accounts.config.min_reputation_score,
       FlintError::SolverReputationTooLow
   );
   ```
   Pass `config` as a read-only account to `SubmitBid`.
4. Add `FlintError::SolverReputationTooLow` to `errors.rs`.
5. Add tests for reputation accumulation and the reputation gate.

---

#### TASK 8: Solver bot — auto-settle and auto-refund loop

**File:** `solver-bot/src/main.rs`

**Current state:** The `run` subcommand only places bids. It does not monitor for won bids and settle them, nor does it watch for timeout opportunities.

**Fix:**
1. In the main event loop (inside `Command::Run`), after the bid placement section, add a second pass:
   ```rust
   // Settle won auctions
   let settled = monitor::poll_won_intents(&client, &program_id, &payer.pubkey()).await;
   for (intent_data, winning_bid_pda) in settled {
       match executor::settle_auction(...).await {
           Ok(sig) => info!(...),
           Err(e) => warn!(...),
       }
   }

   // Trigger refunds for timed-out winning bids
   let timed_out = monitor::poll_timeout_intents(&client, &program_id).await;
   for (intent_data, winning_bid_pda, solver_pubkey) in timed_out {
       match executor::refund_after_timeout(...).await {
           Ok(sig) => info!(...),
           Err(e) => warn!(...),
       }
   }
   ```
2. Add `monitor::poll_won_intents(client, program_id, solver_pubkey) -> Vec<(IntentData, Pubkey)>` that filters open intents where `winning_bid == Some(bid_pda)` and `bid.solver == solver_pubkey` and `current_slot > close_at_slot`.
3. Add `monitor::poll_timeout_intents(client, program_id) -> Vec<(IntentData, Pubkey, Pubkey)>` that returns intents where `status == Open`, `winning_bid.is_some()`, and `current_slot > close_at_slot + REFUND_GRACE_SLOTS`.
4. Replace `getProgramAccounts` polling with account subscription via `RpcClient::account_subscribe` where possible to reduce RPC load.

---

#### TASK 9: Replace file-backed relay store with SQLite

**File:** `relay/store.js`

**Current state:** The store is in-memory with an optional JSON file backup. This is not suitable for production (data lost on restart, no concurrency safety, no indexing).

**Fix:**
1. Add `better-sqlite3` as a dependency: `npm install better-sqlite3`.
2. Rewrite `store.js` to use SQLite with the following schema:
   ```sql
   CREATE TABLE IF NOT EXISTS quote_requests (
     request_id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     quote_deadline_at TEXT NOT NULL,
     input_mint TEXT NOT NULL,
     output_mint TEXT NOT NULL,
     input_amount TEXT NOT NULL,
     min_output_amount TEXT NOT NULL,
     user_pubkey TEXT,
     integrator TEXT,
     callback_url TEXT,
     metadata TEXT,  -- JSON blob
     quotes TEXT,    -- JSON blob
     selected_quote_id TEXT,
     execution_plan TEXT,  -- JSON blob
     execution_result TEXT -- JSON blob
   );

   CREATE TABLE IF NOT EXISTS safety_incidents (
     incident_id TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     data TEXT NOT NULL  -- JSON blob
   );
   ```
3. Keep the same exported interface (`createRequest`, `getRequest`, `listRequests`, `updateRequest`, `createSafetyIncident`, `getSafetyIncident`, `listSafetyFeed`) so `server.js` requires no changes.
4. Add a `FLINT_DB_PATH` environment variable (default: `./flint-relay.db`).
5. Update `relay/relay.test.js` to work with the new SQLite store.

---

#### TASK 10: Add WebSocket event stream to relay

**File:** `relay/server.js`

**Why:** Solvers currently poll `/quote-requests`. A WebSocket push reduces latency and RPC load.

**Implementation:**
1. Add `ws` package: `npm install ws`.
2. Create `relay/ws-server.js`: a `WebSocketServer` that accepts connections and broadcasts events.
3. Events to broadcast:
   - `quote_request.created` — when a new intent is posted
   - `quote.received` — when a solver submits a quote
   - `quote_request.executed` — when an execution plan is selected
   - `quote_request.expired` — when deadline passes with no execution
4. In `server.js`, import and attach the WS server to the same HTTP server.
5. In `sdk/flint-relay-client.ts`, add `subscribeToRequests(callback: (event: RelayEvent) => void): () => void` that opens a WebSocket connection.
6. Add a WS test to `relay/relay.test.js` using the `ws` client.

---

### PHASE 4 — CODE QUALITY & DEVELOPER EXPERIENCE

---

#### TASK 11: Convert all Korean-language comments in Rust source to English

**Files:** All `*.rs` files under `programs/flint/src/`

**Why:** Korean comments block global contributors and make code review harder for non-Korean judges. Korean error messages in `errors.rs` are also a concern.

**Fix:**
1. Translate all `//`, `///`, and `msg!()` strings in Rust source files to English.
2. Translate all `#[msg("...")]` error strings in `errors.rs` to English.
3. Keep the logic 100% identical. This is a text-only change.
4. Grep for remaining Korean: `grep -r '[가-힣]' programs/` should return zero results after this task.

---

#### TASK 12: Increase test coverage — add edge-case tests

**File:** `tests/flint.ts`

**Add the following test cases (each as a named `it()` block):**

1. `"rejects bid below min_output_amount"` — submit intent with `min_output=95`, bid with `output=90`, assert `BidBelowMinimum`.
2. `"rejects bid after auction window closes"` — submit intent, wait for `close_at_slot`, then bid, assert `AuctionClosed`.
3. `"rejects cancel_intent when bid exists"` — submit intent, submit bid, attempt cancel, assert `HasActiveBid`.
4. `"rejects settle before auction window closes"` — submit intent, bid, immediately settle (before window), assert `AuctionStillOpen`.
5. `"rejects slash_solver by non-authority"` — slash with wrong signer, assert `UnauthorizedSlashAuthority`.
6. `"rejects withdraw_stake with active_winning_bids > 0"` — register, bid, do not settle, attempt withdraw, assert `ActiveWinningBidsExist`.
7. `"outbid closes previous BidAccount"` (after TASK 2) — solver A bids, solver B outbids, assert solver A's bid account is closed and rent returned.
8. `"self-bid rejected"` (after TASK 3) — user submits intent and bids on it themselves, assert `SolverCannotBeIntentUser`.
9. `"pause blocks submit_intent"` (after TASK 4) — pause protocol, attempt submit_intent, assert `ProtocolPaused`.
10. `"double-slash prevented"` (after TASK 1) — slash_solver, attempt refund_after_timeout on same intent, assert `IntentAlreadyFinalised`.

---

#### TASK 13: Add Anchor events to missing instructions

**Why:** `cancel_intent` and `withdraw_stake` do not emit events, making them invisible to indexers.

**Fix:**
1. In `cancel_intent.rs`, add:
   ```rust
   #[event]
   pub struct IntentCancelled {
       pub intent: Pubkey,
       pub user: Pubkey,
       pub refunded_amount: u64,
   }
   ```
   Emit it at the end of the handler.

2. In `withdraw_stake.rs`, add:
   ```rust
   #[event]
   pub struct StakeWithdrawn {
       pub solver: Pubkey,
       pub amount: u64,
   }
   ```
   Emit it at the end of the handler.

---

#### TASK 14: Improve solver bot monitor — replace getProgramAccounts with memcmp filters

**File:** `solver-bot/src/monitor.rs`

**Current state:** `poll_open_intents` likely fetches all accounts under the program and deserializes them all — extremely expensive at scale.

**Fix:**
1. Add discriminator-based memcmp filter to `getProgramAccounts` RPC call:
   ```rust
   use solana_client::rpc_filter::{Memcmp, MemcmpEncodedBytes, RpcFilterType};

   let filters = vec![
       // IntentAccount discriminator: first 8 bytes
       RpcFilterType::Memcmp(Memcmp::new(
           0,
           MemcmpEncodedBytes::Bytes(INTENT_DISCRIMINATOR.to_vec()),
       )),
       // status == Open (byte offset 32+32+32+8+8+8+8+8+1 = 137, value = 0 for Open variant)
       RpcFilterType::Memcmp(Memcmp::new(
           137,
           MemcmpEncodedBytes::Bytes(vec![0]), // IntentStatus::Open = 0
       )),
   ];
   ```
2. Compute `INTENT_DISCRIMINATOR` as `sha256("account:IntentAccount")[..8]`.
3. Only deserialize accounts that pass both filters.
4. Add a `dataSize` filter matching `8 + IntentAccount::INIT_SPACE` to reduce false positives.

---

### PHASE 5 — PRODUCTION READINESS

---

#### TASK 15: Add upgrade authority migration to Squads multisig

**File:** `scripts/migrate-upgrade-authority.sh` (new file)

**Why:** The program is currently upgradeable with a single keypair. Production requires multisig.

**Implementation:**
1. Create `scripts/migrate-upgrade-authority.sh`:
   ```bash
   #!/usr/bin/env bash
   # Transfers program upgrade authority to a Squads multisig vault.
   # Usage: MULTISIG_VAULT=<pubkey> PROGRAM_ID=<pubkey> ./scripts/migrate-upgrade-authority.sh
   set -euo pipefail
   PROGRAM_ID="${PROGRAM_ID:-5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt}"
   MULTISIG_VAULT="${MULTISIG_VAULT:?MULTISIG_VAULT must be set}"
   solana program set-upgrade-authority "$PROGRAM_ID" --new-upgrade-authority "$MULTISIG_VAULT"
   echo "Upgrade authority transferred to $MULTISIG_VAULT"
   ```
2. Document in `docs/operator-runbook.md` the exact steps to propose and approve a program upgrade through Squads.

---

#### TASK 16: Add mainnet deployment script and checklist

**File:** `scripts/deploy-mainnet.sh` (new file), `docs/operator-runbook.md`

**Implementation:**
1. Create `scripts/deploy-mainnet.sh` that:
   - Verifies `ANCHOR_WALLET` is set and is a multisig-controlled keypair
   - Verifies `ANCHOR_PROVIDER_URL` points to a paid RPC (Helius/Triton)
   - Runs `anchor build` and `anchor deploy --provider.cluster mainnet`
   - Runs `scripts/init-config.js` to initialize the ConfigAccount on mainnet
   - Outputs deployment summary to `artifacts/mainnet-deploy.json`
2. Add a pre-flight checklist to `docs/operator-runbook.md`:
   - [ ] Program verified on-chain via `solana program show`
   - [ ] Upgrade authority = Squads multisig vault
   - [ ] `ConfigAccount.slash_authority` = ops multisig, NOT deploy keypair
   - [ ] `MIN_STAKE_LAMPORTS` reviewed for mainnet economic conditions
   - [ ] Emergency pause tested on devnet
   - [ ] At least 2 registered solvers with stake
   - [ ] Relay deployed with SQLite store + persistent volume
   - [ ] Alert configured for timeout rate > 5%

---

#### TASK 17: Add on-chain program size optimization

**Why:** Solana programs have a 10 MB limit but devnet deployments are expensive if the binary is large. Optimize for size.

**Fix in `Cargo.toml` (workspace root and programs/flint):**
```toml
[profile.release]
opt-level = "z"      # optimize for size
lto = true
codegen-units = 1
strip = "symbols"
```

Verify after: `ls -lh target/deploy/flint.so`

---

#### TASK 18: Add CI/CD via GitHub Actions

**File:** `.github/workflows/ci.yml` (new file)

**Implementation:**
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Solana
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH
      - name: Install Anchor
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --locked
          avm install 0.30.1
          avm use 0.30.1
      - name: Install Node deps
        run: yarn install
      - name: Build
        run: export PATH="$HOME/.cargo/bin:$PATH" && anchor build --no-idl
      - name: Start validator and test
        run: |
          solana-test-validator --ledger /tmp/flint-ci-ledger --quiet &
          sleep 5
          ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
          ANCHOR_WALLET=~/.config/solana/id.json \
          yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

---

### PHASE 6 — DEMO & STORYTELLING

---

#### TASK 19: Unify product story — remove "Flint Guard" positioning split

**Problem identified in scorecard:** The project currently has two competing narratives:
1. "Flint = on-chain intent auction protocol / protected execution backend" (original)
2. "Flint Guard Console = safety-first routing shell" (newer addition)

Judges see this as a split and deduct points for unclear positioning.

**Fix:**
1. Reframe the Guard Console as **"Flint Operator Console"** — the operator-facing dashboard for the Flint execution backend, not a separate product.
2. Update `flint-console/README.md` to describe the console as the operational interface for the Flint protocol, not a standalone "Flint Guard" product.
3. Update `artifacts/judge-guide.md` to open with a single positioning statement:
   > "Flint is an on-chain protected execution backend. Solvers compete for user swap intents via a sealed-bid auction. The operator console is the control plane."
4. Remove or consolidate the market-positioning doc's "Flint Guard" references — use "Flint Operator Console" consistently.
5. In `README.md`, move the console section under "Operator Tooling" rather than a top-level product heading.

---

#### TASK 20: Record and embed benchmark demo

**Why:** `artifacts/benchmark-summary.md` exists but `README.md` has `[ ] Week 4: benchmark video` as a TODO. Judges cannot verify liveness without a recording.

**Steps:**
1. Run `node scripts/demo.js happy` and `node scripts/demo.js timeout` locally. Record the terminal session using `asciinema rec` or equivalent.
2. Run `node scripts/benchmark.js`. Record output.
3. Save recordings to `artifacts/demo-happy.cast`, `artifacts/demo-timeout.cast`, `artifacts/demo-benchmark.cast`.
4. Upload to a permanent host (e.g., asciinema.org or GitHub Releases).
5. Add links in `README.md` under a "Demo" section:
   ```markdown
   ## Demo

   - [Happy path (local)](link)
   - [Timeout recovery (local)](link)
   - [Benchmark (local)](link)
   ```
6. Mark `[ ] Week 4: benchmark video` as `[x]` in the README roadmap.

---

#### TASK 21: Add solver competition metrics to benchmark artifact

**File:** `scripts/benchmark.js`, `artifacts/benchmark-summary.md`

**Current state:** The benchmark shows 3 scenarios with static expected values. It does not show timing data (how long until settlement), or what happens with N=3, N=4 solvers.

**Enhancements:**
1. In `benchmark.js`, add timing instrumentation:
   - Record `intent_submitted_at_ms`
   - Record `bid_submitted_at_ms` for each solver
   - Record `settlement_confirmed_at_ms`
   - Compute `time_to_first_bid_ms`, `time_to_settlement_ms`
2. Add a 3-solver and 4-solver competition scenario.
3. Output extended JSON to `artifacts/benchmark-local.json` with all timing fields.
4. Regenerate `artifacts/benchmark-summary.md` with a table including:
   | Solvers | Best bid (bps over min) | Time to settlement (ms) |
5. Commit updated artifacts.

---

## GENERAL RULES FOR THE AGENT

1. **Test after every on-chain change.** Run `./scripts/test.sh` (full mocha suite). All existing tests must continue to pass. New tests for the task must also pass.

2. **One commit per task.** Commit message format: `[TASK N] <short description>`. Example: `[TASK 1] Fix double-slash: set intent.status=Expired after slash_solver`.

3. **Do not break the IDL manually.** The IDL at `target/idl/flint.json` and `idl/flint.json` are maintained manually (anchor-syn is incompatible). After adding new instructions, accounts, or events, update both IDL files to match. Follow the existing discriminator calculation pattern: `sha256("global:<instruction_name>")[:8]` for instructions, `sha256("account:<AccountName>")[:8]` for accounts.

4. **Preserve existing devnet artifacts.** Do not modify files under `artifacts/devnet-*`. These are historical records of the deployed state.

5. **Match existing code style:**
   - Rust: `snake_case`, `require!()` for validation, `emit!()` for events, `msg!()` for debug logs
   - TypeScript: `camelCase`, `async/await`, `BN` for u64, `PublicKey.findProgramAddressSync` for PDAs
   - No `unwrap()` in production Rust paths — use `?` or explicit error handling

6. **Keep solver-bot compilable.** After any on-chain instruction change that adds/removes accounts, update the corresponding builder in `solver-bot/src/executor.rs`.

7. **Keep backward compatibility in the relay API.** The relay JSON schema (`relay/openapi.json`) should not have breaking changes. Add fields as optional where necessary.

8. **After all tasks are complete**, run the full stack end-to-end:
   ```bash
   # terminal 1
   solana-test-validator --ledger /tmp/flint-final-ledger --quiet

   # terminal 2
   ./scripts/test.sh                     # all tests green

   # terminal 3
   node relay/index.js                   # relay running

   # terminal 4
   node scripts/demo.js happy            # happy path
   node scripts/demo.js timeout          # timeout path
   node scripts/benchmark.js            # benchmark
   ```
   All flows must complete without errors.

---

## SUCCESS CRITERIA

| Check | Target |
|-------|--------|
| `./scripts/test.sh` | All tests pass, 0 failures |
| New test coverage | All 10 edge-case tests from TASK 12 pass |
| `grep -r '[가-힣]' programs/` | 0 results (TASK 11) |
| `slash_solver` then `refund_after_timeout` | Second call fails with `IntentAlreadyFinalised` |
| Outbid BidAccount | Closed immediately, rent returned to outbid solver |
| Self-bid | Rejected with `SolverCannotBeIntentUser` |
| Pause/unpause | `submit_intent` blocked when paused, allowed when unpaused |
| `artifacts/benchmark-summary.md` | Includes 4-solver scenario and timing data |
| `README.md` roadmap | `[x] Week 4: benchmark video` |
| `relay/store.js` | Uses SQLite, not in-memory JSON |
| `.github/workflows/ci.yml` | Exists and is syntactically valid |

---

*End of Codex Agent Master Prompt — Flint v2*
