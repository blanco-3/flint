export type GuardPolicyPreset = "retail" | "treasury";
export type GuardDataMode = "live" | "demo";
export type DemoScenarioId = "fresh-pool-rug" | "venue-panic" | "unknown-metadata";
export type LocaleCode = "en" | "kr";

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

export type WatchlistState = {
  tokens: string[];
  pairs: string[];
  venues: string[];
};

export type IncidentSeverity = "watch" | "elevated" | "critical";
export type IncidentSource = "manual" | "demo" | "live-session";
export type DecisionPosture = "clear" | "caution" | "degraded" | "blocked";
export type ActionProfileId =
  | "retail-user"
  | "treasury-operator"
  | "bot-executor"
  | "partner-app";

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

export type IncidentPack = {
  id: string;
  name: string;
  source: IncidentSource;
  severity: IncidentSeverity;
  createdAt: string;
  summary: string;
  recommendedAction: string;
  mode: GuardDataMode;
  scenarioId: DemoScenarioId | null;
  policyPreset: GuardPolicyPreset;
  safeMode: boolean;
  panicMode: boolean;
  affectedTokens: string[];
  affectedPairs: string[];
  affectedVenues: string[];
};

export type DecisionReport = {
  headline: string;
  posture: DecisionPosture;
  executionRecommendation: "allow-best-route" | "prefer-safe-route" | "block-execution";
  routeSummary: string;
  orderSummary: string;
  reasons: RouteRiskReason[];
  nextActions: string[];
};

export type PanicActionPlan = {
  severity: IncidentSeverity;
  summary: string;
  candidateOrderKeys: string[];
  blockedRoute: boolean;
  nextSteps: string[];
};

export type DeterministicAuditBundle = {
  version: "1";
  bundleId: string;
  incidentPack: IncidentPack;
  decisionReport: DecisionReport;
  panicActionPlan: PanicActionPlan;
  comparison: QuoteComparison | null;
  ordersLoaded: boolean;
  selectedOrderKeys: string[];
  activityLog: ActivityLogEntry[];
};

export type ActionProfile = {
  id: ActionProfileId;
  label: string;
  description: string;
  executionBias: "user-safe" | "operator-review" | "system-reject";
};

export type SafetyFeedItem = {
  incidentId: string;
  bundleId: string;
  profile: ActionProfileId;
  severity: IncidentSeverity;
  posture: DecisionPosture;
  executionRecommendation: DecisionReport["executionRecommendation"];
  headline: string;
  summary: string;
  candidateOrderCount: number;
  blockedRoute: boolean;
  affectedTokens: string[];
  affectedPairs: string[];
  affectedVenues: string[];
  nextActions: string[];
};

export type SafetyFeedSnapshot = {
  itemCount: number;
  criticalCount: number;
  degradedCount: number;
  blockedCount: number;
  items: SafetyFeedItem[];
};

export type WatchSnapshot = {
  activeIncidentCount: number;
  criticalIncidentCount: number;
  degradedIncidentCount: number;
  blockedRouteCount: number;
};

export type WatchlistMatch = {
  kind: "token" | "pair" | "venue";
  value: string;
  overlapCount: number;
  highestSeverity: IncidentSeverity | null;
  overlappingIncidentIds: string[];
};

export type MarketRiskItem = {
  pairKey: string;
  inputSymbol: string;
  outputSymbol: string;
  inputMint: string;
  outputMint: string;
  venue: string;
  venues: string[];
  status: "safe" | "warn" | "blocked";
  score: number;
  riskLevel: WatchRiskLevel;
  badge: WatchRiskBadge;
  importanceScore: number;
  importanceBucket: ImportanceBucket;
  riskSummary: string;
  nextAction: string;
  dataConfidence: "full-route" | "pair-only";
  factors: MarketRiskFactor[];
  reasonTitles: string[];
  liquidityUsd: number | null;
  priceImpactPct: number | null;
  updatedAt: string;
  poolUrl?: string | null;
};

export type MarketTokenHealth = {
  symbol: string;
  status: "safe" | "warn" | "blocked";
  averageScore: number;
  pairCount: number;
  venueCount: number;
  topReasons: string[];
};

export type MarketVenueHealth = {
  venue: string;
  count: number;
  blockedCount: number;
  warnCount: number;
  status: "safe" | "warn" | "blocked";
};

export type MarketRiskTheme = {
  title: string;
  count: number;
  status: "safe" | "warn" | "blocked";
};

export type WatchRiskLevel = "clear" | "watch" | "elevated" | "critical";
export type WatchRiskBadge = "blocked" | "panic-linked" | null;
export type ImportanceBucket = "large" | "medium" | "small";

export type MarketRiskFactor = {
  id: string;
  title: string;
  score: number;
  detail: string;
};

export type DexMarketPair = {
  pairAddress: string;
  dexId: string | null;
  url: string | null;
  liquidityUsd: number | null;
  pairCreatedAt: number | null;
  priceChangeH1: number | null;
  priceChangeM5: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  baseToken: {
    address: string;
    symbol: string;
    name: string;
  };
  quoteToken: {
    address: string;
    symbol: string;
    name: string;
  };
};

export type JupiterPriceEntry = {
  usdPrice: number;
  blockId: number;
  decimals: number;
  priceChange24h?: number;
};
