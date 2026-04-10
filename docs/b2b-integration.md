# Flint B2B Integration Guide

## What Flint exposes

Flint is positioned as a protected execution backend for wallets, apps, bots, and agentic systems. The on-chain program enforces escrow, timeout recovery, slashing, and solver registration. The relay layer adds off-chain quote collection, selection, and status tracking.

## 5-minute integration path

1. Start the relay:

```bash
node relay/index.js
```

2. Create a quote request:

```ts
import { FlintRelayClient } from "../sdk/flint-relay-client";

const client = new FlintRelayClient("http://127.0.0.1:8787");

const request = await client.createQuoteRequest({
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "USDC111111111111111111111111111111111111111",
  inputAmount: "1000000",
  minOutputAmount: "990000",
  user: "<wallet-pubkey>",
  integrator: "your-app",
});
```

3. Receive solver quotes via polling or webhook updates
4. Execute the best quote:

```ts
const execution = await client.executeRequest({
  requestId: request.requestId,
});
```

5. Poll status:

```ts
const status = await client.getStatus(request.requestId);
```

## API contract

- `POST /quote-request`
- `POST /solver/quote`
- `POST /execute`
- `GET /status/:request_id`
- `GET /quote-requests`

The relay returns a selected solver, quote validity, and an execution plan that references the current `flint-v1` on-chain kernel.

## Failure semantics

- no quotes before deadline -> request remains unexecuted
- relay can continue after webhook delivery failure
- on-chain recovery path remains:
  - `cancel_intent` for no-bid timeout
  - `refund_after_timeout` for winning-bid timeout

## Wallet assumptions

- the current alpha uses the Flint on-chain kernel, so user funds are escrowed on-chain
- integrators should treat relay execution plans as untrusted until verified against the current on-chain IDL and program id
- production deployments should pin a dedicated RPC provider and not rely on public devnet endpoints
