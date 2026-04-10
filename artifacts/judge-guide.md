# Flint Judge Guide

## One-sentence pitch

Flint is a protected execution backend on Solana: registered solvers compete for swap intents, while on-chain escrow, slashing, timeout recovery, and rent-return paths guarantee the lifecycle stays safe even when execution fails.

## What to look at first

- Devnet program: `5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt`
- Happy path smoke: `artifacts/devnet-smoke-happy.json`
- Timeout recovery smoke: `artifacts/devnet-smoke-timeout.json`
- Benchmark summary: `artifacts/benchmark-summary.md`

## Recommended demo order

1. Show the devnet deploy artifact
2. Show the happy path devnet smoke tx
3. Show the timeout recovery devnet smoke tx
4. Show the benchmark summary
5. Show the relay/API alpha and TypeScript SDK as the productization direction

## Why this matters

- registered solvers only
- explicit slash authority
- timeout refund path prevents stuck funds
- terminal paths return rent
- B2B API direction avoids competing head-on as another consumer swap app
