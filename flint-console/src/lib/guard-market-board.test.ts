import { strict as assert } from "assert";

import {
  sortMarketRiskItems,
  summarizeRiskThemes,
  summarizeRiskVenues,
  summarizeTokenHealth,
} from "./guard-market-board";
import type { MarketRiskItem } from "./guard-types";

describe("guard market board", () => {
  const items: MarketRiskItem[] = [
    {
      pairKey: "a",
      inputSymbol: "SOL",
      outputSymbol: "USDC",
      inputMint: "sol",
      outputMint: "usdc",
      venue: "raydium",
      venues: ["raydium", "orca"],
      status: "warn",
      score: 72,
      riskLevel: "elevated",
      badge: null,
      importanceScore: 68,
      importanceBucket: "medium",
      riskSummary: "Shallow liquidity is pushing this route higher.",
      nextAction: "Review before trading.",
      dataConfidence: "full-route",
      factors: [],
      reasonTitles: ["Shallow liquidity"],
      liquidityUsd: 12000,
      priceImpactPct: 1.2,
      updatedAt: "2026-05-06T00:00:00Z",
    },
    {
      pairKey: "b",
      inputSymbol: "SOL",
      outputSymbol: "BONK",
      inputMint: "sol",
      outputMint: "bonk",
      venue: "pumpswap",
      venues: ["pumpswap"],
      status: "blocked",
      score: 90,
      riskLevel: "critical",
      badge: "blocked",
      importanceScore: 52,
      importanceBucket: "medium",
      riskSummary: "Blocked venue and poor fallback make this critical.",
      nextAction: "Do not execute now.",
      dataConfidence: "full-route",
      factors: [],
      reasonTitles: ["Panic venue signal"],
      liquidityUsd: 3000,
      priceImpactPct: 5.2,
      updatedAt: "2026-05-06T00:00:00Z",
    },
    {
      pairKey: "c",
      inputSymbol: "JUP",
      outputSymbol: "SOL",
      inputMint: "jup",
      outputMint: "sol",
      venue: "raydium",
      venues: ["raydium"],
      status: "safe",
      score: 12,
      riskLevel: "clear",
      badge: null,
      importanceScore: 75,
      importanceBucket: "large",
      riskSummary: "No significant stress factors are active.",
      nextAction: "Continue monitoring.",
      dataConfidence: "full-route",
      factors: [],
      reasonTitles: [],
      liquidityUsd: 50000,
      priceImpactPct: 0.4,
      updatedAt: "2026-05-06T00:00:00Z",
    },
  ];

  it("sorts riskiest items first", () => {
    const sorted = sortMarketRiskItems(items);
    assert.equal(sorted[0].pairKey, "b");
    assert.equal(sorted[1].pairKey, "a");
  });

  it("summarizes top venues by occurrence", () => {
    const venues = summarizeRiskVenues(items);
    assert.equal(venues[0].venue, "pumpswap");
    assert.equal(venues[0].status, "blocked");
  });

  it("summarizes token health from risky pairs", () => {
    const tokens = summarizeTokenHealth(items);
    assert.equal(tokens[0].symbol, "BONK");
    assert.equal(tokens[0].status, "blocked");
    assert.equal(tokens.find((token) => token.symbol === "SOL")?.pairCount, 3);
  });

  it("summarizes repeated risk themes", () => {
    const themes = summarizeRiskThemes(items);
    assert.equal(themes[0].title, "Panic venue signal");
    assert.equal(themes[0].status, "blocked");
  });
});
