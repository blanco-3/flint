# Flint Relay Request State Diagram

```mermaid
flowchart TD
    A[POST /quote-request] --> B[open]
    B --> C[POST /solver/quote]
    C --> D[quoted]
    D --> E[POST /execute]
    E --> F[selected]
    F --> G[executed]
    F --> H[refund path / on-chain timeout recovery]
```

## Meaning of each state

- `open`
  - request created
  - quote deadline active
  - no solver quote accepted yet
- `quoted`
  - at least one solver quote received
  - request still waiting for selection
- `selected`
  - relay chose a winning quote
  - execution plan materialized
- `executed`
  - relay recorded an execution result payload

## On-chain terminal mapping

- `settle_auction`
  - success path
- `refund_after_timeout`
  - timeout recovery path

The relay is an alpha coordination layer. The Flint on-chain kernel remains the authority for escrow, solver accountability, slashing, and timeout recovery.
