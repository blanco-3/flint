# Flint Guard Long Arc Context Snapshot

## Task statement
Turn Flint into an incident-aware execution control plane with shared canonical Watch state, backend-backed risk synthesis, explainable scoring, and operator-grade UX that is defensible against Colosseum winner quality comparisons.

## Desired outcome
- Relay becomes the canonical Watch snapshot authority.
- Frontend Watch consumes backend state instead of assembling live state per-client.
- Risk scoring becomes more structured and explainable.
- Shared incident/feed semantics become more truthful.
- Product story clearly differentiates Flint from Jupiter, URANI, Capitola, Tokamai, CONYR, grid.wtf, and Unruggable.

## Known facts / evidence
- Current HEAD: `ce30d87`
- On-chain P0/P1 fixes already landed and pushed.
- Frontend still contains local Watch assembly logic using Jupiter + DexScreener.
- Relay currently supports quote requests, solver quotes, execute status, and safety-feed CRUD.
- Colosseum Copilot auth is working and returned `authenticated: true` on `2026-05-07`.
- Colosseum benchmark set for this task:
  - `urani` = intent/mev-protected swap aggregator
  - `capitola` = consumer meta-aggregator
  - `blackpool` = privacy + mev-resistant DEX
  - `tokamai` = real-time monitoring and alerts
  - `conyr` = real-time anomaly/security analytics
  - `grid.wtf` = modular trading terminal
  - `unruggable` / `unruggable-2` = wallet/transaction safety

## Constraints
- Must follow repo AGENTS.md + Flint AGENTS.md.
- `idl/flint.json` is source of truth.
- Use `./scripts/build.sh`, `./scripts/test.sh`, and `diff idl/flint.json target/idl/flint.json`.
- No destructive git operations.
- Commit messages must follow Lore protocol.
- Existing local uncommitted frontend changes should be preserved and worked with, not reverted.

## Unknowns / open questions
- How much of the current Watch factor logic should be reused directly in relay versus simplified/ported.
- Whether SSE can be added in the same batch without destabilizing relay tests.
- How far to move current client-side story/score semantics in the first backend authority batch.

## Likely codebase touchpoints
- `relay/server.js`
- `relay/store.js`
- `relay/relay.test.js`
- `flint-console/src/App.tsx`
- `flint-console/src/lib/guard-types.ts`
- `flint-console/src/lib/guard-feed-client.ts`
- `flint-console/src/lib/guard-market-board.ts`
- `flint-console/src/lib/guard-watch-risk.ts`
- `flint-console/src/lib/guard-market-data.ts`
