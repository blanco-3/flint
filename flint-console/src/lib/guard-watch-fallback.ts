import { fetchPrices, fetchQuote } from "./guard-jupiter";
import { fetchLiveMarketPairs, fetchPoolSnapshots } from "./guard-market-data";
import { sortMarketRiskItems, summarizeRiskThemes, summarizeRiskVenues, summarizeTokenHealth } from "./guard-market-board";
import { evaluateQuoteRisk } from "./guard-risk";
import { buildPairOnlyWatchRiskItem, buildWatchRiskItem } from "./guard-watch-risk";
import type {
  DexMarketPair,
  JupiterPriceEntry,
  PoolSnapshot,
  RiskPolicy,
  WatchScoreModel,
  WatchSourceStatus,
  WatchServerSnapshot,
} from "./guard-types";
import { tokenByMint, tokenChoices, type TokenOption } from "./token-options";

const LOCAL_SCORE_MODEL: WatchScoreModel = {
  version: "watch-v1-local-fallback",
  severityBuckets: {
    clearMax: 24,
    watchMax: 49,
    elevatedMax: 74,
    criticalMin: 75,
  },
  confidenceRules: {
    fullRoute: "Live quote, venue path, and pair stress signals are available in local fallback mode.",
    pairOnly: "Live route quote is unavailable, so only pair-level signals are scored in local fallback mode.",
  },
  factors: [
    { id: "liquidity", title: "Shallow liquidity", dataSource: "DexScreener", rationale: "Thin pools break first.", maxScore: 40 },
    { id: "freshness", title: "Fresh pool", dataSource: "DexScreener", rationale: "Young pools are easier to destabilize.", maxScore: 30 },
    { id: "price-shock", title: "Price shock", dataSource: "DexScreener", rationale: "Fast dislocations often precede route breakage.", maxScore: 30 },
    { id: "flow", title: "Sell pressure", dataSource: "DexScreener", rationale: "One-sided flow is an early warning signal.", maxScore: 30 },
    { id: "venue", title: "Venue trust", dataSource: "Jupiter route labels", rationale: "Weaker venues deserve more friction.", maxScore: 45 },
    { id: "token", title: "Token risk", dataSource: "Observed token set", rationale: "Long-tail tokens carry more uncertainty.", maxScore: 10 },
    { id: "execution", title: "Execution fragility", dataSource: "Jupiter quote shape", rationale: "Fragile routes are direct execution signals.", maxScore: 30 },
  ],
};

export async function buildLocalWatchSnapshot(policy: RiskPolicy, limit = 12) {
  const sourceStatus: WatchSourceStatus = {
    dexscreener: "live",
    jupiterPrice: "live",
    jupiterQuote: "live",
  };
  const degradedReasons = ["relay_unavailable_client_fallback"];

  const livePairs = await fetchLiveMarketPairs(tokenChoices().map((token) => token.mint), limit);
  if (!livePairs.length) {
    throw new Error("market_board_refresh_failed");
  }

  const prices: Record<string, JupiterPriceEntry> = await fetchPrices(
    dedupeStrings(livePairs.flatMap((pair) => [pair.baseToken.address, pair.quoteToken.address]))
  ).catch(() => {
    sourceStatus.jupiterPrice = "degraded";
    degradedReasons.push("price_source_unavailable");
    return {} as Record<string, JupiterPriceEntry>;
  });

  const rows = (
    await Promise.allSettled(
      livePairs.map(async (pair) => {
        const direction = chooseQuoteDirection(pair);
        if (!direction) {
          throw new Error("market_pair_direction_unavailable");
        }
        const inputToken =
          tokenByMint(direction.inputMint) ??
          syntheticToken(direction.inputMint, direction.inputSymbol);
        const outputToken =
          tokenByMint(direction.outputMint) ??
          syntheticToken(direction.outputMint, direction.outputSymbol);
        const usdPrice = prices[direction.inputMint]?.usdPrice ?? null;
        const amount = sampleQuoteAmount(inputToken, usdPrice);

        try {
          const quote = await fetchQuote({
            inputMint: direction.inputMint,
            outputMint: direction.outputMint,
            amount: rawAmountFromForm(amount, inputToken.decimals),
            slippageBps: 75,
          });
          const pools = await fetchPoolSnapshots(quote.routePlan.map((hop) => hop.swapInfo.ammKey));
          const assessment = evaluateQuoteRisk(quote, pools, policy);
          const routeVenues = dedupeStrings(
            quote.routePlan.map((hop) => hop.swapInfo.label || "unknown")
          );
          const primaryPool =
            quote.routePlan[0]?.swapInfo.ammKey
              ? pools[quote.routePlan[0].swapInfo.ammKey]
              : null;
          return {
            ...buildWatchRiskItem({
              inputToken,
              outputToken,
              quote,
              primaryPool: primaryPool ?? pairToPoolSnapshot(pair),
              assessment,
              policy,
              routeVenues,
              hasSafeFallback: assessment.status !== "blocked",
            }),
            poolUrl: primaryPool?.url ?? pair.url ?? null,
          };
        } catch {
          sourceStatus.jupiterQuote = "degraded";
          if (!degradedReasons.includes("quote_source_partially_unavailable")) {
            degradedReasons.push("quote_source_partially_unavailable");
          }
          return buildPairOnlyWatchRiskItem({
            inputToken,
            outputToken,
            primaryPool: pairToPoolSnapshot(pair),
            routeVenues: dedupeStrings([pair.dexId ?? "unknown"]),
            policy,
          });
        }
      })
    )
  ).reduce<WatchServerSnapshot["marketBoard"]>((acc, result) => {
    if (result.status === "fulfilled") {
      acc.push(result.value);
    }
    return acc;
  }, []);

  if (!rows.length) {
    throw new Error("market_board_refresh_failed");
  }

  const marketBoard = sortMarketRiskItems(rows);
  const updatedAt = new Date().toISOString();

  return {
    snapshotVersion: updatedAt,
    updatedAt,
    staleAfterMs: 45_000,
    scoreModelVersion: LOCAL_SCORE_MODEL.version,
    scoreModel: LOCAL_SCORE_MODEL,
    sourceStatus,
    degradedReasons,
    itemCount: marketBoard.length,
    criticalCount: marketBoard.filter((item) => item.riskLevel === "critical" || item.status === "blocked").length,
    blockedCount: marketBoard.filter((item) => item.status === "blocked").length,
    changedCount: marketBoard.length,
    marketBoard,
    marketTokens: summarizeTokenHealth(marketBoard),
    marketThemes: summarizeRiskThemes(marketBoard),
    marketVenues: summarizeRiskVenues(marketBoard),
  } satisfies WatchServerSnapshot;
}

function chooseQuoteDirection(pair: {
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
}) {
  const baseKnown = tokenByMint(pair.baseToken.address);
  const quoteKnown = tokenByMint(pair.quoteToken.address);
  if (baseKnown) {
    return {
      inputMint: pair.baseToken.address,
      inputSymbol: pair.baseToken.symbol,
      outputMint: pair.quoteToken.address,
      outputSymbol: pair.quoteToken.symbol,
    };
  }
  if (quoteKnown) {
    return {
      inputMint: pair.quoteToken.address,
      inputSymbol: pair.quoteToken.symbol,
      outputMint: pair.baseToken.address,
      outputSymbol: pair.baseToken.symbol,
    };
  }
  return null;
}

function sampleQuoteAmount(token: TokenOption, usdPrice: number | null) {
  if (!usdPrice || usdPrice <= 0) {
    if (token.symbol === "USDC") return "250";
    if (token.symbol === "SOL" || token.symbol === "mSOL" || token.symbol === "jitoSOL") return "1";
    if (token.symbol === "JUP") return "500";
    if (token.symbol === "BONK") return "500000";
    return "100";
  }
  const targetUsd = 250;
  return String(Number((targetUsd / usdPrice).toFixed(token.decimals > 6 ? 4 : 2)));
}

function syntheticToken(mint: string, symbol: string): TokenOption {
  return { mint, symbol, name: symbol, decimals: 6 };
}

function pairToPoolSnapshot(pair: DexMarketPair): PoolSnapshot {
  return {
    ammKey: pair.pairAddress,
    dexId: pair.dexId,
    liquidityUsd: pair.liquidityUsd,
    pairCreatedAt: pair.pairCreatedAt,
    priceChangeH1: pair.priceChangeH1,
    priceChangeM5: pair.priceChangeM5,
    buysM5: pair.buysM5,
    sellsM5: pair.sellsM5,
    url: pair.url,
  };
}

function rawAmountFromForm(amount: string, decimals: number) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Enter a valid positive amount.");
  }
  return String(Math.round(normalized * Math.pow(10, decimals)));
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
