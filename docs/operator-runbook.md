# Flint Operator Runbook

## Recommended infrastructure

- Primary RPC: Helius or Triton One
- Fallback RPC: FluxRPC or a second paid provider
- Upgrade authority: Squads multisig
- Alerts: Telegram, PagerDuty, or equivalent

## Relay operations

- run the relay with a persistent state file:

```bash
FLINT_RELAY_STATE_FILE=.relay-state/requests.json node relay/index.js
```

- use webhook consumers for lifecycle notifications
- do not parallelize devnet smoke flows against public RPCs; rate limits will trigger `429`

## Production readiness gates

- multisig-controlled upgrade authority
- emergency pause
- explicit fee policy
- observability dashboards:
  - solver fill rate
  - timeout rate
  - request latency
  - refund/slash counts

## Current alpha limitations

- relay persistence is file-backed for local use
- solver quote ingestion is HTTP-based, not streaming
- execution plans reference the current `flint-v1` kernel rather than a fully off-chain quote-commit path
