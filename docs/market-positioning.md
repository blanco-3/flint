# Flint Market Positioning

## Chosen wedge

Flint should be built and presented as a **B2B protected execution API**, not as another retail swap app.

## Why not another consumer swap app

- The retail swap and routing layer on Solana is already crowded.
- Jupiter Ultra/Juno and JupiterZ already cover large parts of routing, RFQ, and execution.
- Consumer-facing DEX or swap UX differentiation is hard to sustain unless Flint becomes a router or aggregator with major distribution.

## Why Flint has a real gap

Flint already has ingredients that map well to a horizontal execution layer:

- registered solvers
- explicit slash authority
- timeout refund / recovery
- deterministic lifecycle guarantees
- rent-return cleanup

This makes Flint stronger as execution infrastructure for wallets, bots, treasury tools, and agentic systems than as a direct-to-consumer UI.

## Product framing

Flint is:

- a protected execution network
- an accountable solver marketplace
- a fallback-safe settlement layer
- an integrator-facing API backed by on-chain enforcement

Flint is not:

- another “best route” frontend
- another general-purpose DEX
- a pure router competing head-on with Jupiter

## Strategic implications

- prioritize relay/API, SDK, and solver/operator tooling over frontend polish
- keep the current on-chain kernel as the enforcement layer
- move quote competition off the hot on-chain path over time
- use devnet smoke, benchmark artifacts, and judge-guide as the immediate pitch surface

## Frontier resource alignment

- RPC / data infra: Helius, Triton One, FluxRPC
- Treasury / security ops: Squads multisig
- Market research: Colosseum Copilot examples and archive corpus
