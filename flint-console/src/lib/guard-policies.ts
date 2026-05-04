import type { GuardPolicyPreset, RiskPolicy, RiskSignalInputs } from "./guard-types";

export const DEFAULT_SIGNAL_INPUTS: RiskSignalInputs = {
  tokens: [],
  pairs: [],
  venues: [],
};

export const POLICY_PRESETS: Record<GuardPolicyPreset, RiskPolicy> = {
  retail: {
    id: "retail",
    label: "Retail mode",
    minPoolAgeHours: 12,
    minLiquidityUsd: 50_000,
    maxPriceImpactPct: 1.5,
    maxHops: 2,
    maxNegativePriceChangeH1Pct: -18,
    sellPressureRatio: 3,
    blockMissingPoolMetadata: false,
    denylistVenues: [],
    flaggedTokens: [],
    panicTokens: [],
    panicPairs: [],
    panicVenues: [],
  },
  treasury: {
    id: "treasury",
    label: "Treasury mode",
    minPoolAgeHours: 72,
    minLiquidityUsd: 250_000,
    maxPriceImpactPct: 0.75,
    maxHops: 1,
    maxNegativePriceChangeH1Pct: -10,
    sellPressureRatio: 2,
    blockMissingPoolMetadata: true,
    denylistVenues: ["pumpswap"],
    flaggedTokens: [],
    panicTokens: [],
    panicPairs: [],
    panicVenues: [],
  },
};

export function canonicalVenue(value: string) {
  return value.trim().toLowerCase();
}

export function canonicalMint(value: string) {
  return value.trim();
}

export function canonicalPairKey(inputMint: string, outputMint: string) {
  return [canonicalMint(inputMint), canonicalMint(outputMint)].sort().join("::");
}

export function policyCopy(policy: RiskPolicy): RiskPolicy {
  return JSON.parse(JSON.stringify(policy));
}
