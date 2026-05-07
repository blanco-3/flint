# Flint Positioning

## Short version

Flint is not trying to replace Jupiter as a swap engine.

Flint is an **incident-aware execution control plane** for Solana:

- shared Watch state
- explainable market risk scoring
- execution gating
- shared incident memory
- panic-response handoff into Protect

## Why this exists

In abnormal markets, the problem is not only price discovery.

The harder problem is:

1. recognizing that execution conditions are deteriorating
2. getting multiple operators to see the same state
3. deciding whether to continue, reroute, or stop
4. carrying that incident context into response actions

Jupiter solves execution access. Flint is designed to solve shared execution safety.

## What Flint is not

### Not just another aggregator

- `urani` shows that intent-based aggregation and MEV mitigation can win on execution quality.
- `capitola` shows that meta-aggregation and best-price access can win on consumer utility.

Flint should not compete by saying “we also aggregate routes.”

Flint should compete by saying:

> “When the market is abnormal, we decide whether execution should happen at all, and we let every operator read the same state.”

### Not just another trading terminal

- `grid.wtf` shows that modular trading terminal UX is a valid product on its own.

Flint should not rely on terminal aesthetics alone.

Flint needs to justify its interface through shared state, risk semantics, and response workflow.

### Not just monitoring

- `tokamai` proves monitoring and alerting for Solana systems is valuable.
- `conyr` proves real-time anomaly analytics is valuable.

Flint overlaps with monitoring, but Flint is not only a monitoring surface.

Flint must carry monitoring into action:

- Watch
- Trade gating
- Protect handoff
- shared incident lifecycle

### Not just wallet security

- `unruggable` and `unruggable-2` prove wallet and signing safety are real product categories.

Flint can coexist with wallet-security products, but its center of gravity is execution-state coordination, not key custody.

## Shared state is the real differentiator

Without a backend, every browser can see a slightly different picture:

- different quote timing
- different degraded sources
- different board ranking
- different incident interpretation

That weakens the operator story immediately.

With a backend-backed canonical Watch snapshot:

- the board is synthesized once
- all users read the same snapshot version
- source degradation is explicit
- incident state can be shared and transitioned

This is the control-plane move that separates Flint from a browser-only dashboard.

## Who this is for

### Primary users

- treasury operators
- protocol risk teams
- high-conviction traders
- security-conscious execution operators

### Secondary users

- power users
- partner apps
- bots and automation layers

### Not the first target

- generic retail users who only want the cheapest swap

Those users should probably continue using Jupiter directly unless Flint proves additional value through strong Watch/Protect behavior.

## The right product sentence

Use this sentence consistently:

> Flint is an incident-aware execution control plane for Solana that turns abnormal market signals into shared operator state, execution gating, and response workflows.

## Why now

Solana is fast enough that abnormal execution conditions propagate quickly.

That means:

- opportunity appears fast
- risk appears fast
- bad execution compounds fast

The faster the market, the more valuable shared decision state becomes.

## Internal product test

If Flint cannot answer these three questions clearly, it is drifting:

1. Why not just use Jupiter?
2. Why not just use Tokamai?
3. Why do multiple operators need to see the same state?

The current correct answers are:

1. Jupiter is the execution backbone, not the incident-aware control plane.
2. Tokamai monitors systems, but Flint connects market stress to execution gating and response.
3. Shared state is what makes risk coordination credible instead of cosmetic.
