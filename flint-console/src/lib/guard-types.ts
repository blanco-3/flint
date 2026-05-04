export type GuardPolicyPreset = "retail" | "treasury";
export type GuardDataMode = "live" | "demo";
export type DemoScenarioId = "fresh-pool-rug" | "venue-panic" | "unknown-metadata";

export type QuoteFormState = {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
};

export type RiskSignalInputs = {
  tokens: string[];
  pairs: string[];
  venues: string[];
};

export type RiskPolicy = {
  id: GuardPolicyPreset;
  label: string;
  minPoolAgeHours: number;
  minLiquidityUsd: number;
  maxPriceImpactPct: number;
  maxHops: number;
  maxNegativePriceChangeH1Pct: number;
  sellPressureRatio: number;
  blockMissingPoolMetadata: boolean;
  denylistVenues: string[];
  flaggedTokens: string[];
  panicTokens: string[];
  panicPairs: string[];
  panicVenues: string[];
};

export type JupiterRouteHop = {
  percent: number | null;
  swapInfo: {
    ammKey: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
    label: string;
  };
};

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRouteHop[];
  contextSlot?: number;
  timeTaken?: number;
};

export type PoolSnapshot = {
  ammKey: string;
  dexId: string | null;
  liquidityUsd: number | null;
  pairCreatedAt: number | null;
  priceChangeH1: number | null;
  priceChangeM5: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  url: string | null;
};

export type RouteRiskReason = {
  id: string;
  subject: string;
  title: string;
  detail: string;
  blocking: boolean;
  severity: "low" | "medium" | "high";
  scope: "route" | "hop" | "token" | "venue" | "order";
};

export type RouteHopAssessment = {
  ammKey: string;
  label: string;
  percent: number | null;
  reasons: RouteRiskReason[];
  liquidityUsdLabel: string;
  ageLabel: string;
};

export type RouteAssessment = {
  status: "safe" | "warn" | "blocked";
  score: number;
  reasons: RouteRiskReason[];
  hops: RouteHopAssessment[];
  blockedVenues: string[];
  flaggedTokens: string[];
};

export type QuoteComparison = {
  baseQuote: JupiterQuote;
  baseAssessment: RouteAssessment;
  safeQuote: JupiterQuote | null;
  safeAssessment: RouteAssessment | null;
  blockedVenuesUsed: string[];
  safeMode: boolean;
  executionTarget: "base" | "safe" | "none";
};

export type TriggerOrder = {
  orderKey: string;
  userPubkey: string;
  inputMint: string;
  outputMint: string;
  venue?: string;
  rawMakingAmount: string;
  rawTakingAmount: string;
  remainingMakingAmount?: string;
  remainingTakingAmount?: string;
  slippageBps?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
};

export type OrderAssessment = {
  order: TriggerOrder;
  candidate: boolean;
  reasons: RouteRiskReason[];
};

export type ActivityLogEntry = {
  id: string;
  createdAt: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  kind: "activity" | "incident";
};

export type DemoScenario = {
  id: DemoScenarioId;
  label: string;
  summary: string;
  form: QuoteFormState;
  signals: RiskSignalInputs;
};
