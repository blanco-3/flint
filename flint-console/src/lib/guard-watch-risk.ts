import type {
  JupiterQuote,
  MarketRiskFactor,
  MarketRiskItem,
  PoolSnapshot,
  RiskPolicy,
  RouteAssessment,
  WatchRiskBadge,
  WatchRiskLevel,
} from "./guard-types";
import type { TokenOption } from "./token-options";

const MAJOR_SYMBOLS = new Set(["SOL", "USDC", "JUP", "mSOL", "jitoSOL", "BONK"]);

export function buildWatchRiskItem(input: {
  inputToken: TokenOption;
  outputToken: TokenOption;
  quote: JupiterQuote;
  primaryPool: PoolSnapshot | null;
  assessment: RouteAssessment;
  policy: RiskPolicy;
  routeVenues: string[];
  hasSafeFallback: boolean;
}): MarketRiskItem {
  const {
    inputToken,
    outputToken,
    quote,
    primaryPool,
    assessment,
    policy,
    routeVenues,
    hasSafeFallback,
  } = input;

  const liquidityStress = factor(
    "liquidity",
    "Shallow liquidity",
    liquidityStressScore(primaryPool?.liquidityUsd ?? null),
    primaryPool?.liquidityUsd
      ? `$${Math.round(primaryPool.liquidityUsd).toLocaleString()} liquidity on the primary pool.`
      : "Primary liquidity is unknown."
  );
  const freshnessRisk = factor(
    "freshness",
    "Fresh pool",
    freshnessRiskScore(primaryPool?.pairCreatedAt ?? null),
    primaryPool?.pairCreatedAt
      ? `${hoursOld(primaryPool.pairCreatedAt).toFixed(1)}h since creation.`
      : "Pool age is unknown."
  );
  const priceShockRisk = factor(
    "price-shock",
    "Price shock",
    priceShockRiskScore(primaryPool?.priceChangeM5 ?? null, primaryPool?.priceChangeH1 ?? null),
    `m5 ${formatPercent(primaryPool?.priceChangeM5 ?? null)} · h1 ${formatPercent(primaryPool?.priceChangeH1 ?? null)}`
  );
  const flowImbalanceRisk = factor(
    "flow",
    "Sell pressure",
    flowImbalanceRiskScore(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null),
    flowDetail(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null)
  );
  const venueTrustRisk = factor(
    "venue",
    "Venue trust",
    venueTrustRiskScore(routeVenues, policy),
    routeVenues.join(" / ")
  );
  const tokenRisk = factor(
    "token",
    "Token risk",
    tokenRiskScore(inputToken.symbol, outputToken.symbol, inputToken.mint, outputToken.mint, policy),
    `${inputToken.symbol} -> ${outputToken.symbol}`
  );
  const executionFragility = factor(
    "execution",
    "Execution fragility",
    executionFragilityScore(quote, assessment, hasSafeFallback),
    `${quote.routePlan.length} hops · ${Number(quote.priceImpactPct || "0").toFixed(2)}% impact`
  );

  const factors = [
    liquidityStress,
    freshnessRisk,
    priceShockRisk,
    flowImbalanceRisk,
    venueTrustRisk,
    tokenRisk,
    executionFragility,
  ];

  const rawRiskScore = clamp(factors.reduce((sum, item) => sum + item.score, 0), 0, 100);
  const badge = buildBadge(assessment, policy);
  const riskScore = enforceRiskFloor(rawRiskScore, assessment, badge);
  const riskLevel = riskLevelFromScore(riskScore);
  const importanceScore = buildImportanceScore(inputToken.symbol, outputToken.symbol, primaryPool?.liquidityUsd ?? null);
  const importanceBucket = importanceBucketFromScore(importanceScore);
  const topFactors = [...factors]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const topFactorTitles = topFactors.slice(0, 3).map((item) => item.title);

  return {
    pairKey: `${inputToken.symbol}/${outputToken.symbol}`,
    inputSymbol: inputToken.symbol,
    outputSymbol: outputToken.symbol,
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    venue: routeVenues[0] ?? "unknown",
    venues: routeVenues,
    status: badge === "blocked" ? "blocked" : riskScore >= 50 ? "warn" : "safe",
    score: riskScore,
    reasonTitles: topFactorTitles,
    liquidityUsd: primaryPool?.liquidityUsd ?? null,
    priceImpactPct: Number.isFinite(Number(quote.priceImpactPct))
      ? Number(quote.priceImpactPct)
      : null,
    updatedAt: new Date().toISOString(),
    poolUrl: primaryPool?.url ?? null,
    riskLevel,
    badge,
    importanceScore,
    importanceBucket,
    riskSummary: summarizeRisk(topFactors, assessment, badge),
    factors: topFactors,
  };
}

function factor(id: string, title: string, score: number, detail: string): MarketRiskFactor {
  return {
    id,
    title,
    score,
    detail,
  };
}

function liquidityStressScore(liquidityUsd: number | null) {
  if (liquidityUsd === null) return 12;
  if (liquidityUsd >= 1_000_000) return 0;
  if (liquidityUsd >= 250_000) return 10;
  if (liquidityUsd >= 50_000) return 25;
  return 40;
}

function freshnessRiskScore(pairCreatedAt: number | null) {
  if (pairCreatedAt === null) return 10;
  const hours = hoursOld(pairCreatedAt);
  if (hours > 24 * 30) return 0;
  if (hours > 24 * 7) return 5;
  if (hours > 24) return 15;
  return 30;
}

function priceShockRiskScore(m5: number | null, h1: number | null) {
  const absM5 = Math.abs(m5 ?? 0);
  const absH1 = Math.abs(h1 ?? 0);
  if (absM5 > 15 || absH1 > 35) return 30;
  if (absM5 > 8 || absH1 > 20) return 20;
  if (absM5 > 3 || absH1 > 10) return 10;
  return 0;
}

function flowImbalanceRiskScore(sells: number | null, buys: number | null) {
  if (sells === null || buys === null) return 8;
  const ratio = sells / Math.max(buys, 1);
  if (ratio > 5) return 30;
  if (ratio >= 3) return 20;
  if (ratio >= 1.5) return 10;
  return 0;
}

function venueTrustRiskScore(routeVenues: string[], policy: RiskPolicy) {
  const normalized = routeVenues.map((venue) => venue.toLowerCase());
  if (normalized.some((venue) => policy.panicVenues.map((item) => item.toLowerCase()).includes(venue))) {
    return 45;
  }
  if (normalized.some((venue) => policy.denylistVenues.map((item) => item.toLowerCase()).includes(venue))) {
    return 35;
  }
  if (normalized.some((venue) => venue.includes("pump") || venue.includes("unknown"))) {
    return 10;
  }
  return 0;
}

function tokenRiskScore(
  inputSymbol: string,
  outputSymbol: string,
  inputMint: string,
  outputMint: string,
  policy: RiskPolicy
) {
  const symbols = [inputSymbol, outputSymbol];
  const mints = [inputMint, outputMint];
  if (mints.some((mint) => policy.panicTokens.includes(mint))) return 40;
  if (mints.some((mint) => policy.flaggedTokens.includes(mint))) return 30;
  if (symbols.every((symbol) => MAJOR_SYMBOLS.has(symbol))) return 0;
  return 10;
}

function executionFragilityScore(
  quote: JupiterQuote,
  assessment: RouteAssessment,
  hasSafeFallback: boolean
) {
  const priceImpact = Number(quote.priceImpactPct || "0");
  if (assessment.status === "blocked" && !hasSafeFallback) return 35;
  if (assessment.status === "warn" && !hasSafeFallback) return 20;
  if (quote.routePlan.length > 1 || priceImpact > 3) return 10;
  return 0;
}

function buildImportanceScore(
  inputSymbol: string,
  outputSymbol: string,
  liquidityUsd: number | null
) {
  const liquidityComponent =
    liquidityUsd === null
      ? 20
      : liquidityUsd >= 1_000_000
        ? 45
        : liquidityUsd >= 250_000
          ? 30
          : liquidityUsd >= 50_000
            ? 18
            : 8;
  const majorAssetBonus =
    Number(MAJOR_SYMBOLS.has(inputSymbol)) * 15 + Number(MAJOR_SYMBOLS.has(outputSymbol)) * 15;
  const routeUsageBonus =
    (inputSymbol === "SOL" || outputSymbol === "SOL" ? 15 : 0) +
    (inputSymbol === "USDC" || outputSymbol === "USDC" ? 10 : 0);
  return clamp(liquidityComponent + majorAssetBonus + routeUsageBonus, 0, 100);
}

function buildBadge(assessment: RouteAssessment, policy: RiskPolicy): WatchRiskBadge {
  if (assessment.status === "blocked") return "blocked";
  const hasPanicSignal =
    assessment.reasons.some((reason) => reason.id.includes("panic")) ||
    assessment.blockedVenues.some((venue) =>
      policy.panicVenues.map((item) => item.toLowerCase()).includes(venue.toLowerCase())
    );
  return hasPanicSignal ? "panic-linked" : null;
}

function enforceRiskFloor(
  score: number,
  assessment: RouteAssessment,
  badge: WatchRiskBadge
) {
  if (badge === "panic-linked") return Math.max(score, 90);
  if (assessment.status === "blocked" || badge === "blocked") return Math.max(score, 80);
  return score;
}

function riskLevelFromScore(score: number): WatchRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "elevated";
  if (score >= 25) return "watch";
  return "clear";
}

function importanceBucketFromScore(score: number) {
  if (score >= 70) return "large";
  if (score >= 40) return "medium";
  return "small";
}

function summarizeRisk(factors: MarketRiskFactor[], assessment: RouteAssessment, badge: WatchRiskBadge) {
  const top = factors.slice(0, 2).map((factor) => factor.title);
  if (top.includes("Fresh pool") && top.includes("Shallow liquidity")) {
    return "Fresh and shallow liquidity make this pool vulnerable to slippage and fast exits.";
  }
  if (top.includes("Sell pressure") && top.includes("Price shock")) {
    return "Sell pressure and price shock are rising together, so execution quality can break quickly.";
  }
  if (top.includes("Venue trust") && !assessment.blockedVenues.length) {
    return "Venue trust is weak enough that the route deserves manual review before execution.";
  }
  if (badge === "blocked" || (top.includes("Venue trust") && top.includes("Execution fragility"))) {
    return "The route is already in a blocked posture and there is no comfortable execution lane right now.";
  }
  return top.length
    ? `${top.join(" + ")} are the main reasons this route is climbing the risk board.`
    : "No major market stress factors are active on this route right now.";
}

function flowDetail(sells: number | null, buys: number | null) {
  if (sells === null || buys === null) {
    return "Short-term trade flow is unavailable.";
  }
  return `${sells} sells vs ${buys} buys over the last 5m.`;
}

function hoursOld(timestamp: number) {
  return (Date.now() - timestamp) / 3_600_000;
}

function formatPercent(value: number | null) {
  if (value === null) return "n/a";
  return `${value.toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
