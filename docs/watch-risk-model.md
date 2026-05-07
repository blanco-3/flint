# Flint Watch Risk Model

## Purpose

Flint Watch is not a generic trading dashboard. It is an incident-aware execution map that turns live market stress into a shared operator state.

The backend owns the canonical Watch snapshot so every connected user can read the same:

- `marketBoard`
- `marketThemes`
- `marketTokens`
- `marketVenues`
- `sourceStatus`
- `degradedReasons`
- `snapshotVersion`

## Why this model exists

Solana already has strong execution backbones and aggregators. `urani` proves intent-based aggregation and MEV protection can win on execution quality. `capitola` proves best-price aggregation can win on access and liquidity. Flint should not compete on those terms alone.

Instead, Flint scores whether the market is safe enough to execute through, and whether operators should hold, reroute, or move into Protect.

That makes Flint closer to an incident-aware control plane than a standard swap front-end.

## Canonical backend snapshot

The relay produces a shared Watch snapshot with:

- `snapshotVersion`
- `updatedAt`
- `staleAfterMs`
- `scoreModelVersion`
- `scoreModel`
- `sourceStatus`
- `degradedReasons`
- `criticalCount`
- `blockedCount`
- `changedCount`

This keeps the main Watch path authoritative and shared across users instead of letting each browser assemble its own slightly different board.

## Factor taxonomy

Current score model version: `watch-v1`

### 1. Shallow liquidity

- Source: DexScreener pair liquidity
- Why it matters: thin pools lose execution quality first
- Max contribution: `40`

### 2. Fresh pool

- Source: DexScreener `pairCreatedAt`
- Why it matters: young pools have weaker market history and are easier to destabilize
- Max contribution: `30`

### 3. Price shock

- Source: DexScreener `m5` and `h1` price change
- Why it matters: fast dislocations often precede route breakage
- Max contribution: `30`

### 4. Sell pressure

- Source: DexScreener `m5` buys vs sells
- Why it matters: one-sided flow is an early warning for deteriorating exits
- Max contribution: `30`

### 5. Venue trust

- Source: Jupiter route labels and observed venue identity
- Why it matters: low-trust venues deserve higher routing friction
- Max contribution: `45`

### 6. Token risk

- Source: observed token set
- Why it matters: long-tail tokens carry more uncertainty than major monitored assets
- Max contribution: `10`

### 7. Execution fragility

- Source: Jupiter route hops and price impact
- Why it matters: fragile route shapes and missing quotes are direct execution signals
- Max contribution: `30`

## Severity buckets

- `0-24`: `clear`
- `25-49`: `watch`
- `50-74`: `elevated`
- `75+`: `critical`

Items also map into route posture:

- `safe`
- `warn`
- `blocked`

`blocked` is a stronger operator signal than pure score rank and is reserved for severe venue or execution breakage.

## Confidence model

### `full-route`

- A live quote exists
- Route venues exist
- Pair stress signals exist

### `pair-only`

- Live quote is unavailable
- Pair-level stress signals still exist
- The item stays visible, but Flint marks execution certainty as degraded

This is important because Flint should not pretend route authority when it only has pair-level evidence.

## Operator semantics

The Watch score is not meant to answer “what is the best price?”

It answers:

1. Is this pair deteriorating fast enough to deserve attention?
2. Is execution quality weak enough to block or reroute?
3. Should the operator move from Watch into Protect?

## Notes

- This score is intentionally explainable rather than maximally complex.
- The backend should only score signals it can actually observe.
- If a signal cannot be defended, it should be removed or renamed rather than cosmetically retained.
