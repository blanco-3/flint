# Flint Guard Console

Flint Guard Console is the visible safety-first execution shell layered on top of the Flint stack.

## Modes

- **Seeded Demo Mode**
  - ships deterministic incident scenarios
  - simulates safer-route execution and panic cancellation for judge demos
  - does not require live Jupiter orders to tell the full product story
- **Live API Mode**
  - fetches routes from Jupiter Metis
  - fetches open trigger orders from Jupiter Trigger
  - uses DexScreener pool metadata for risk scoring
  - signs live transactions with an injected Solana wallet

## Current capabilities

- compare best-price vs safer route
- block unsafe routes in safe mode
- explain risky venues, pools, and tokens
- load panic-order candidates
- simulate or submit panic cancellation
- export incident bundles for review

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```
