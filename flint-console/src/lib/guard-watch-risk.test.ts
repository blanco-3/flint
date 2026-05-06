import { strict as assert } from "assert";

import { buildPairOnlyWatchRiskItem, buildWatchRiskItem } from "./guard-watch-risk";
import type { JupiterQuote, PoolSnapshot, RiskPolicy, RouteAssessment } from "./guard-types";
import type { TokenOption } from "./token-options";

describe("guard watch risk scoring", () => {
  const inputToken: TokenOption = {
    symbol: "SOL",
    name: "Solana",
    mint: "sol",
    decimals: 9,
  };
  const outputToken: TokenOption = {
    symbol: "BONK",
    name: "Bonk",
    mint: "bonk",
    decimals: 5,
  };
  const quote: JupiterQuote = {
    inputMint: "sol",
    inAmount: "1000000000",
    outputMint: "bonk",
    outAmount: "100000",
    otherAmountThreshold: "0",
    swapMode: "ExactIn",
    slippageBps: 75,
    priceImpactPct: "6.5",
    routePlan: [
      {
        percent: 100,
        swapInfo: {
          ammKey: "amm-1",
          inputMint: "sol",
          outputMint: "bonk",
          inAmount: "1000000000",
          outAmount: "100000",
          feeAmount: "0",
          feeMint: "sol",
          label: "pumpswap",
        },
      },
    ],
  };
  const pool: PoolSnapshot = {
    ammKey: "amm-1",
    dexId: "pump",
    liquidityUsd: 20_000,
    pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000,
    priceChangeH1: -28,
    priceChangeM5: -11,
    buysM5: 8,
    sellsM5: 42,
    url: "https://example.com/pool",
  };
  const assessment: RouteAssessment = {
    status: "blocked",
    score: 20,
    reasons: [],
    hops: [],
    blockedVenues: ["pumpswap"],
    flaggedTokens: [],
  };
  const policy: RiskPolicy = {
    id: "retail",
    label: "Retail",
    minPoolAgeHours: 24,
    minLiquidityUsd: 50_000,
    maxPriceImpactPct: 3,
    maxHops: 2,
    maxNegativePriceChangeH1Pct: -20,
    sellPressureRatio: 3,
    blockMissingPoolMetadata: false,
    denylistVenues: [],
    flaggedTokens: [],
    panicTokens: [],
    panicPairs: [],
    panicVenues: ["pumpswap"],
  };

  it("builds a high risk score and critical badge for stressed blocked pools", () => {
    const item = buildWatchRiskItem({
      inputToken,
      outputToken,
      quote,
      primaryPool: pool,
      assessment,
      policy,
      routeVenues: ["pumpswap"],
      hasSafeFallback: false,
    });

    assert.equal(item.badge, "blocked");
    assert.equal(item.riskLevel, "critical");
    assert.ok(item.score >= 80);
    assert.equal(item.importanceBucket, "medium");
    assert.ok(item.reasonTitles.length >= 2);
  });

  it("builds a degraded pair-only item when live route data is unavailable", () => {
    const item = buildPairOnlyWatchRiskItem({
      inputToken,
      outputToken,
      primaryPool: pool,
      routeVenues: ["pumpswap"],
      policy,
    });

    assert.equal(item.dataConfidence, "pair-only");
    assert.equal(item.riskLevel, "critical");
    assert.ok(item.nextAction.length > 0);
  });
});
