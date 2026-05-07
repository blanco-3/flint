# PRD: Flint Guard Live Product Phases A/B/C

## Product Thesis

Flint Guard should stop presenting itself as a seeded-demo safety shell and instead feel like a live execution safety product that operators and power users could plausibly use today.

## Immediate Goal

Complete the visible productization phases that were previously identified:

1. Phase A — Trade as a real swap product
2. Phase B — Watch as an automatic market risk board
3. Phase C — Protect as a real incident-response tool

## Scope

### Phase A — Trade
- Improve token and pair selection ergonomics.
- Surface route posture, execution recommendation, and major reasons after a quote.
- Make “blocked / safer route / clear route” states obvious and action-oriented.

### Phase B — Watch
- De-emphasize manual watchlist and import-first workflows from the main surface.
- Show automatic risk summaries for major assets, risky pairs, and venue concentration.
- Emphasize high-value risk information visually and operationally.

### Phase C — Protect
- Clarify current exposure and candidate count.
- Show why current orders are risky and what the next action is.
- Preserve live cancel behavior while improving operator clarity.

## Out of Scope
- New dependencies
- New backend architecture
- Full alert delivery infrastructure
- Full replay / backtest surface

## Acceptance Shape
- Main surface looks live-first.
- Trade / Watch / Protect each have obvious value on first use.
- Seeded demo is secondary.
- Build, lint, app tests, relay tests, SDK checks, and Flint legacy verification all pass.
