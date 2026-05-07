# Flint Product Roadmap

## Current state

Flint has moved beyond a purely browser-local safety dashboard.

The product now has:

- relay-backed canonical Watch snapshots
- explainable Watch score model metadata
- shared incident feed state transitions
- Watch SSE stream plus polling fallback
- degraded local Watch fallback when relay is unavailable
- broader Trade token discovery beyond the original static list

That makes Flint a stronger early control-plane product, but not yet a mature operator platform.

## What must happen to reach product level

### Phase 1 — Canonical Watch state

Status: `in progress`

Done:

- shared Watch snapshot endpoint
- Watch history endpoint
- SSE snapshot stream
- frontend subscriber path

Still needed:

- real multi-user smoke verification
- source-specific observability and operator diagnostics
- stronger stale / degraded semantics in the UI

### Phase 2 — Defensible risk scoring

Status: `in progress`

Done:

- documented score model
- factor taxonomy
- source health metadata
- confidence-aware pair-only fallback

Still needed:

- more explicit score breakdown UI
- clearer per-factor operator implications
- better calibration under long-tail pair conditions

### Phase 3 — Shared incident operations

Status: `in progress`

Done:

- shared incident publication
- incident lifecycle states
- frontend state transition controls

Still needed:

- notes / owner / acknowledgment metadata
- stronger Protect linkage
- incident-centric Activity views

### Phase 4 — Alert-ready backend

Status: `next`

Goals:

- changed-since-last-sync summaries
- critical-only digest logic
- event schema suitable for Telegram / Discord / webhook delivery later
- durable backend state beyond the current lightweight relay store

This is the phase that turns Flint from a shared dashboard into a real operator surface.

### Phase 5 — Trade as a credible execution gate

Status: `in progress`

Done:

- broader token discovery
- rate-limit hardening
- route posture and safer fallback behavior

Still needed:

- even broader token universe
- better first-touch trust for live quotes
- cleaner explanation of why Flint should block or allow execution

### Phase 6 — Operator-grade Watch UX

Status: `next`

Goals:

- stronger change highlighting
- denser but clearer risk map
- less dashboard clutter
- more memorable visual identity

Reference pressure:

- `grid.wtf` for terminal clarity
- `tokamai` for monitoring seriousness
- `conyr` for anomaly-monitoring credibility

### Phase 7 — Product narrative and judge readiness

Status: `ongoing`

Goals:

- keep the product framed as an incident-aware execution control plane
- explicitly avoid collapsing into “another swap UI”
- maintain direct answers to:
  - why not just Jupiter?
  - why not just Tokamai?
  - why not just grid.wtf?
  - why do multiple operators need the same state?

## Near-term execution order

1. Alert-ready Watch metrics and changed-state semantics
2. Stronger incident-centric Protect handoff
3. Broader Trade discovery and route trust hardening
4. Durable relay storage and team-shared incident memory
5. Notification delivery channels after Watch/Alert core is fully credible
