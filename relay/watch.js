const SWAP_API_ROOT = "https://lite-api.jup.ag/swap/v1";
const PRICE_API_ROOT = "https://api.jup.ag/price/v3";
const WATCH_CACHE_MS = 45_000;
const REQUEST_TIMEOUT_MS = 12_000;

const TOKEN_UNIVERSE = [
  {
    symbol: "SOL",
    name: "Solana",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
  },
  {
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6Xc5x6sJvtJ6a8wX",
    decimals: 5,
  },
  {
    symbol: "mSOL",
    name: "Marinade staked SOL",
    mint: "mSoLzYCxHdYgdzUuP9nD2p7xU7eD7LZf8hTz7f7d92x",
    decimals: 9,
  },
  {
    symbol: "jitoSOL",
    name: "Jito Staked SOL",
    mint: "J1toso1uCXnS7FZLkJ6BxVQxzLhcM1YMe73PvvrQ4ep",
    decimals: 9,
  },
];

const MAJOR_SYMBOLS = new Set(TOKEN_UNIVERSE.map((token) => token.symbol));
const DENYLIST_VENUES = new Set(["pumpfun amm", "unknown"]);
const PANIC_VENUES = new Set(["pumpfun amm"]);

function createWatchService({
  fetchImpl = fetch,
  now = () => new Date(),
  cacheMs = WATCH_CACHE_MS,
  limit = 12,
  tokenUniverse = TOKEN_UNIVERSE,
} = {}) {
  let cachedSnapshot = null;
  let inFlight = null;
  let history = [];

  async function getSnapshot({ force = false } = {}) {
    const currentTime = now();
    if (
      !force &&
      cachedSnapshot &&
      currentTime.getTime() - Date.parse(cachedSnapshot.updatedAt) < cacheMs
    ) {
      return structuredClone(cachedSnapshot);
    }

    if (inFlight) {
      return structuredClone(await inFlight);
    }

    inFlight = buildSnapshot({
      fetchImpl,
      now: currentTime,
      limit,
      tokenUniverse,
      previousSnapshot: cachedSnapshot,
    })
      .then((snapshot) => {
        cachedSnapshot = snapshot;
        history = [snapshot, ...history].slice(0, 20);
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
      });

    return structuredClone(await inFlight);
  }

  function listHistory(limitValue = 10) {
    return structuredClone(history.slice(0, limitValue));
  }

  return {
    getSnapshot,
    listHistory,
  };
}

async function buildSnapshot({
  fetchImpl,
  now,
  limit,
  tokenUniverse,
  previousSnapshot,
}) {
  const sourceStatus = {
    dexscreener: "live",
    jupiterPrice: "live",
    jupiterQuote: "live",
  };
  const degradedReasons = [];

  const livePairs = await fetchLiveMarketPairs(fetchImpl, tokenUniverse.map((token) => token.mint), limit);
  if (!livePairs.length) {
    throw new Error("watch_snapshot_pairs_unavailable");
  }

  const prices = await fetchPrices(
    fetchImpl,
    dedupeStrings(livePairs.flatMap((pair) => [pair.baseToken.address, pair.quoteToken.address]))
  ).catch(() => {
    sourceStatus.jupiterPrice = "degraded";
    degradedReasons.push("price_source_unavailable");
    return {};
  });

  const rows = [];
  for (const pair of livePairs) {
    const direction = chooseQuoteDirection(pair, tokenUniverse);
    if (!direction) {
      continue;
    }

    const inputToken = tokenByMint(direction.inputMint, tokenUniverse) ?? syntheticToken(direction.inputMint, direction.inputSymbol);
    const outputToken = tokenByMint(direction.outputMint, tokenUniverse) ?? syntheticToken(direction.outputMint, direction.outputSymbol);
    const usdPrice = prices[direction.inputMint]?.usdPrice ?? null;
    const amount = sampleQuoteAmount(inputToken, usdPrice);
    const pairPool = pairToPoolSnapshot(pair);

    try {
      const quote = await fetchQuote(fetchImpl, {
        inputMint: direction.inputMint,
        outputMint: direction.outputMint,
        amount: rawAmountFromForm(amount, inputToken.decimals),
        slippageBps: 75,
      });
      const primaryPool =
        quote.routePlan[0]?.swapInfo?.ammKey
          ? (await fetchPoolSnapshot(fetchImpl, quote.routePlan[0].swapInfo.ammKey)) ?? pairPool
          : pairPool;
      rows.push(
        buildWatchRiskItem({
          inputToken,
          outputToken,
          quote,
          primaryPool,
          routeVenues: dedupeStrings(quote.routePlan.map((hop) => hop.swapInfo.label || "unknown")),
          now,
        })
      );
    } catch {
      sourceStatus.jupiterQuote = "degraded";
      if (!degradedReasons.includes("quote_source_partially_unavailable")) {
        degradedReasons.push("quote_source_partially_unavailable");
      }
      rows.push(
        buildPairOnlyWatchRiskItem({
          inputToken,
          outputToken,
          primaryPool: pairPool,
          routeVenues: dedupeStrings([pair.dexId ?? "unknown"]),
          now,
        })
      );
    }
  }

  const marketBoard = sortMarketRiskItems(rows).slice(0, limit);
  const changedCount = previousSnapshot ? countChangedPairs(previousSnapshot.marketBoard, marketBoard) : marketBoard.length;
  const updatedAt = now.toISOString();

  return {
    snapshotVersion: updatedAt,
    updatedAt,
    staleAfterMs: cacheMsOrDefault(),
    sourceStatus,
    degradedReasons,
    itemCount: marketBoard.length,
    criticalCount: marketBoard.filter((item) => item.riskLevel === "critical" || item.status === "blocked").length,
    blockedCount: marketBoard.filter((item) => item.status === "blocked").length,
    changedCount,
    marketBoard,
    marketTokens: summarizeTokenHealth(marketBoard),
    marketThemes: summarizeRiskThemes(marketBoard),
    marketVenues: summarizeRiskVenues(marketBoard),
  };
}

function cacheMsOrDefault() {
  return WATCH_CACHE_MS;
}

async function fetchLiveMarketPairs(fetchImpl, tokenMints, limit) {
  const responses = await Promise.all(tokenMints.map((mint) => fetchTokenPairs(fetchImpl, mint)));
  const seen = new Map();

  for (const pairs of responses) {
    for (const pair of pairs) {
      if (!seen.has(pair.pairAddress)) {
        seen.set(pair.pairAddress, pair);
      }
    }
  }

  return [...seen.values()]
    .sort((left, right) => {
      const liquidityDiff = (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0);
      if (liquidityDiff !== 0) return liquidityDiff;
      return Math.abs(right.priceChangeH1 ?? 0) - Math.abs(left.priceChangeH1 ?? 0);
    })
    .slice(0, limit);
}

async function fetchTokenPairs(fetchImpl, mint) {
  try {
    const response = await requestJson(fetchImpl, `https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    return (response.pairs ?? [])
      .filter((pair) => pair.chainId === "solana")
      .map((pair) => ({
        pairAddress: pair.pairAddress ?? "",
        dexId: pair.dexId ?? null,
        url: pair.url ?? null,
        liquidityUsd:
          pair.liquidity && typeof pair.liquidity.usd === "number" ? pair.liquidity.usd : null,
        pairCreatedAt: typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
        priceChangeH1:
          pair.priceChange && typeof pair.priceChange.h1 === "number" ? pair.priceChange.h1 : null,
        priceChangeM5:
          pair.priceChange && typeof pair.priceChange.m5 === "number" ? pair.priceChange.m5 : null,
        buysM5:
          pair.txns && pair.txns.m5 && typeof pair.txns.m5.buys === "number"
            ? pair.txns.m5.buys
            : null,
        sellsM5:
          pair.txns && pair.txns.m5 && typeof pair.txns.m5.sells === "number"
            ? pair.txns.m5.sells
            : null,
        baseToken: {
          address: pair.baseToken?.address ?? "",
          symbol: pair.baseToken?.symbol ?? "unknown",
          name: pair.baseToken?.name ?? "Unknown token",
        },
        quoteToken: {
          address: pair.quoteToken?.address ?? "",
          symbol: pair.quoteToken?.symbol ?? "unknown",
          name: pair.quoteToken?.name ?? "Unknown token",
        },
      }))
      .filter((pair) => pair.pairAddress && pair.baseToken.address && pair.quoteToken.address);
  } catch {
    return [];
  }
}

async function fetchPoolSnapshot(fetchImpl, ammKey) {
  try {
    const response = await requestJson(
      fetchImpl,
      `https://api.dexscreener.com/latest/dex/pairs/solana/${ammKey}`
    );
    const pair = response.pairs && response.pairs[0];
    if (!pair) return null;
    return {
      ammKey,
      dexId: pair.dexId ?? null,
      liquidityUsd:
        pair.liquidity && typeof pair.liquidity.usd === "number" ? pair.liquidity.usd : null,
      pairCreatedAt: typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
      priceChangeH1:
        pair.priceChange && typeof pair.priceChange.h1 === "number" ? pair.priceChange.h1 : null,
      priceChangeM5:
        pair.priceChange && typeof pair.priceChange.m5 === "number" ? pair.priceChange.m5 : null,
      buysM5:
        pair.txns && pair.txns.m5 && typeof pair.txns.m5.buys === "number"
          ? pair.txns.m5.buys
          : null,
      sellsM5:
        pair.txns && pair.txns.m5 && typeof pair.txns.m5.sells === "number"
          ? pair.txns.m5.sells
          : null,
      url: pair.url ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchPrices(fetchImpl, mints) {
  const ids = dedupeStrings(mints).slice(0, 50);
  if (!ids.length) return {};
  const url = new URL(PRICE_API_ROOT);
  url.searchParams.set("ids", ids.join(","));
  return requestJson(fetchImpl, url.toString());
}

async function fetchQuote(fetchImpl, input) {
  const url = new URL(`${SWAP_API_ROOT}/quote`);
  url.searchParams.set("inputMint", input.inputMint);
  url.searchParams.set("outputMint", input.outputMint);
  url.searchParams.set("amount", input.amount);
  url.searchParams.set("slippageBps", String(input.slippageBps));
  const payload = await requestJson(fetchImpl, url.toString());
  if (payload.error) {
    throw new Error(payload.error || "quote_fetch_failed");
  }
  return payload;
}

async function requestJson(fetchImpl, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`request_failed_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildWatchRiskItem({ inputToken, outputToken, quote, primaryPool, routeVenues, now }) {
  const factors = [
    factor("liquidity", "Shallow liquidity", liquidityStressScore(primaryPool?.liquidityUsd ?? null), detailLiquidity(primaryPool?.liquidityUsd ?? null)),
    factor("freshness", "Fresh pool", freshnessRiskScore(primaryPool?.pairCreatedAt ?? null, now), detailFreshness(primaryPool?.pairCreatedAt ?? null, now)),
    factor("price-shock", "Price shock", priceShockRiskScore(primaryPool?.priceChangeM5 ?? null, primaryPool?.priceChangeH1 ?? null), `m5 ${formatPercent(primaryPool?.priceChangeM5 ?? null)} · h1 ${formatPercent(primaryPool?.priceChangeH1 ?? null)}`),
    factor("flow", "Sell pressure", flowImbalanceRiskScore(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null), flowDetail(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null)),
    factor("venue", "Venue trust", venueTrustRiskScore(routeVenues), routeVenues.join(" / ")),
    factor("token", "Token risk", tokenRiskScore(inputToken.symbol, outputToken.symbol), `${inputToken.symbol} -> ${outputToken.symbol}`),
    factor("execution", "Execution fragility", executionFragilityScore(quote), `${quote.routePlan.length} hop(s) · ${formatImpact(Number(quote.priceImpactPct || "0"))}`),
  ].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const rawScore = clamp(factors.reduce((sum, item) => sum + item.score, 0), 0, 100);
  const blocked = isBlocked(factors, quote, routeVenues);
  const score = blocked ? Math.max(rawScore, 80) : rawScore;
  const riskLevel = riskLevelFromScore(score);
  const importanceScore = buildImportanceScore(inputToken.symbol, outputToken.symbol, primaryPool?.liquidityUsd ?? null);
  const reasonTitles = factors.filter((item) => item.score > 0).slice(0, 3).map((item) => item.title);

  return {
    pairKey: `${inputToken.symbol}/${outputToken.symbol}`,
    inputSymbol: inputToken.symbol,
    outputSymbol: outputToken.symbol,
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    venue: routeVenues[0] ?? "unknown",
    venues: routeVenues,
    status: blocked ? "blocked" : score >= 50 ? "warn" : "safe",
    score,
    riskLevel,
    badge: blocked ? "blocked" : PANIC_VENUES.has((routeVenues[0] ?? "").toLowerCase()) ? "panic-linked" : null,
    importanceScore,
    importanceBucket: importanceBucketFromScore(importanceScore),
    riskSummary: summarizeRisk(factors, blocked),
    nextAction: buildNextAction(score, blocked),
    dataConfidence: "full-route",
    factors: factors.filter((item) => item.score > 0),
    reasonTitles,
    liquidityUsd: primaryPool?.liquidityUsd ?? null,
    priceImpactPct: Number.isFinite(Number(quote.priceImpactPct)) ? Number(quote.priceImpactPct) : null,
    updatedAt: now.toISOString(),
    poolUrl: primaryPool?.url ?? null,
  };
}

function buildPairOnlyWatchRiskItem({ inputToken, outputToken, primaryPool, routeVenues, now }) {
  const factors = [
    factor("liquidity", "Shallow liquidity", liquidityStressScore(primaryPool?.liquidityUsd ?? null), detailLiquidity(primaryPool?.liquidityUsd ?? null)),
    factor("freshness", "Fresh pool", freshnessRiskScore(primaryPool?.pairCreatedAt ?? null, now), detailFreshness(primaryPool?.pairCreatedAt ?? null, now)),
    factor("price-shock", "Price shock", priceShockRiskScore(primaryPool?.priceChangeM5 ?? null, primaryPool?.priceChangeH1 ?? null), `m5 ${formatPercent(primaryPool?.priceChangeM5 ?? null)} · h1 ${formatPercent(primaryPool?.priceChangeH1 ?? null)}`),
    factor("flow", "Sell pressure", flowImbalanceRiskScore(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null), flowDetail(primaryPool?.sellsM5 ?? null, primaryPool?.buysM5 ?? null)),
    factor("venue", "Venue trust", venueTrustRiskScore(routeVenues), routeVenues.join(" / ")),
    factor("token", "Token risk", tokenRiskScore(inputToken.symbol, outputToken.symbol), `${inputToken.symbol} -> ${outputToken.symbol}`),
    factor("execution", "Execution certainty degraded", 18, "Live quote is unavailable, so this item is scored from pair-level stress signals only."),
  ].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const rawScore = clamp(factors.reduce((sum, item) => sum + item.score, 0), 0, 100);
  const score = Math.max(rawScore, 55);
  const importanceScore = buildImportanceScore(inputToken.symbol, outputToken.symbol, primaryPool?.liquidityUsd ?? null);

  return {
    pairKey: `${inputToken.symbol}/${outputToken.symbol}`,
    inputSymbol: inputToken.symbol,
    outputSymbol: outputToken.symbol,
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    venue: routeVenues[0] ?? "unknown",
    venues: routeVenues,
    status: score >= 75 ? "blocked" : "warn",
    score,
    riskLevel: riskLevelFromScore(score),
    badge: null,
    importanceScore,
    importanceBucket: importanceBucketFromScore(importanceScore),
    riskSummary: "Pair-level market stress is elevated and the live route is currently unavailable.",
    nextAction: "Review before trading. Wait for a fresh route quote or move to Protect if related exposure already exists.",
    dataConfidence: "pair-only",
    factors: factors.filter((item) => item.score > 0),
    reasonTitles: factors.filter((item) => item.score > 0).slice(0, 3).map((item) => item.title),
    liquidityUsd: primaryPool?.liquidityUsd ?? null,
    priceImpactPct: null,
    updatedAt: now.toISOString(),
    poolUrl: primaryPool?.url ?? null,
  };
}

function summarizeTokenHealth(items) {
  const tokens = new Map();
  for (const item of items) {
    for (const symbol of [item.inputSymbol, item.outputSymbol]) {
      const current = tokens.get(symbol) ?? {
        status: "safe",
        scoreSum: 0,
        pairKeys: new Set(),
        venues: new Set(),
        reasons: new Map(),
      };
      current.status = worseStatus(current.status, item.status);
      current.scoreSum += item.score;
      current.pairKeys.add(item.pairKey);
      for (const venue of item.venues.length ? item.venues : [item.venue]) {
        current.venues.add(venue);
      }
      for (const reason of item.reasonTitles) {
        current.reasons.set(reason, (current.reasons.get(reason) ?? 0) + 1);
      }
      tokens.set(symbol, current);
    }
  }

  return [...tokens.entries()]
    .map(([symbol, value]) => ({
      symbol,
      status: value.status,
      averageScore: Math.round(value.scoreSum / value.pairKeys.size),
      pairCount: value.pairKeys.size,
      venueCount: value.venues.size,
      topReasons: [...value.reasons.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([reason]) => reason),
    }))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.averageScore - a.averageScore || a.symbol.localeCompare(b.symbol));
}

function summarizeRiskThemes(items) {
  const themes = new Map();
  for (const item of items) {
    for (const title of item.reasonTitles) {
      const current = themes.get(title) ?? { count: 0, status: "safe" };
      current.count += 1;
      current.status = worseStatus(current.status, item.status);
      themes.set(title, current);
    }
  }
  return [...themes.entries()]
    .map(([title, value]) => ({ title, count: value.count, status: value.status }))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 6);
}

function summarizeRiskVenues(items) {
  const venues = new Map();
  for (const item of items) {
    for (const venue of item.venues.length ? item.venues : [item.venue]) {
      const current = venues.get(venue) ?? { count: 0, blockedCount: 0, warnCount: 0, status: "safe" };
      current.count += 1;
      if (item.status === "blocked") current.blockedCount += 1;
      if (item.status === "warn") current.warnCount += 1;
      current.status = worseStatus(current.status, item.status);
      venues.set(venue, current);
    }
  }
  return [...venues.entries()]
    .map(([venue, value]) => ({ venue, ...value }))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.count - a.count || a.venue.localeCompare(b.venue))
    .slice(0, 5);
}

function countChangedPairs(previousItems, nextItems) {
  const previous = new Map(previousItems.map((item) => [item.pairKey, item]));
  let changed = 0;
  for (const item of nextItems) {
    const prior = previous.get(item.pairKey);
    if (!prior) {
      changed += 1;
      continue;
    }
    if (prior.status !== item.status || prior.score !== item.score || prior.riskLevel !== item.riskLevel) {
      changed += 1;
    }
  }
  return changed;
}

function factor(id, title, score, detail) {
  return { id, title, score, detail };
}

function chooseQuoteDirection(pair, tokenUniverse) {
  const baseKnown = tokenByMint(pair.baseToken.address, tokenUniverse);
  const quoteKnown = tokenByMint(pair.quoteToken.address, tokenUniverse);
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

function tokenByMint(mint, tokenUniverse) {
  return tokenUniverse.find((token) => token.mint === mint) ?? null;
}

function syntheticToken(mint, symbol) {
  return { mint, symbol, name: symbol, decimals: 6 };
}

function sampleQuoteAmount(token, usdPrice) {
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

function rawAmountFromForm(amount, decimals) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("invalid_quote_amount");
  }
  return String(Math.round(normalized * Math.pow(10, decimals)));
}

function pairToPoolSnapshot(pair) {
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

function liquidityStressScore(liquidityUsd) {
  if (liquidityUsd === null) return 12;
  if (liquidityUsd >= 1_000_000) return 0;
  if (liquidityUsd >= 250_000) return 10;
  if (liquidityUsd >= 50_000) return 25;
  return 40;
}

function freshnessRiskScore(pairCreatedAt, now) {
  if (pairCreatedAt === null) return 10;
  const hours = (now.getTime() - pairCreatedAt) / 3_600_000;
  if (hours > 24 * 30) return 0;
  if (hours > 24 * 7) return 5;
  if (hours > 24) return 15;
  return 30;
}

function priceShockRiskScore(m5, h1) {
  const absM5 = Math.abs(m5 ?? 0);
  const absH1 = Math.abs(h1 ?? 0);
  if (absM5 > 15 || absH1 > 35) return 30;
  if (absM5 > 8 || absH1 > 20) return 20;
  if (absM5 > 3 || absH1 > 10) return 10;
  return 0;
}

function flowImbalanceRiskScore(sells, buys) {
  if (sells === null || buys === null) return 8;
  const ratio = sells / Math.max(buys, 1);
  if (ratio > 5) return 30;
  if (ratio >= 3) return 20;
  if (ratio >= 1.5) return 10;
  return 0;
}

function venueTrustRiskScore(routeVenues) {
  const normalized = routeVenues.map((venue) => venue.toLowerCase());
  if (normalized.some((venue) => PANIC_VENUES.has(venue))) return 45;
  if (normalized.some((venue) => DENYLIST_VENUES.has(venue))) return 35;
  return normalized.some((venue) => venue.includes("pump") || venue.includes("unknown")) ? 10 : 0;
}

function tokenRiskScore(inputSymbol, outputSymbol) {
  if (MAJOR_SYMBOLS.has(inputSymbol) && MAJOR_SYMBOLS.has(outputSymbol)) return 0;
  return 10;
}

function executionFragilityScore(quote) {
  const priceImpact = Number(quote.priceImpactPct || "0");
  if (priceImpact > 5) return 30;
  if (quote.routePlan.length > 2 || priceImpact > 2.5) return 18;
  if (quote.routePlan.length > 1 || priceImpact > 0.5) return 8;
  return 0;
}

function buildImportanceScore(inputSymbol, outputSymbol, liquidityUsd) {
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
  const majorBonus = Number(MAJOR_SYMBOLS.has(inputSymbol)) * 15 + Number(MAJOR_SYMBOLS.has(outputSymbol)) * 15;
  const routeBonus = (inputSymbol === "SOL" || outputSymbol === "SOL" ? 15 : 0) + (inputSymbol === "USDC" || outputSymbol === "USDC" ? 10 : 0);
  return clamp(liquidityComponent + majorBonus + routeBonus, 0, 100);
}

function importanceBucketFromScore(score) {
  if (score >= 70) return "large";
  if (score >= 40) return "medium";
  return "small";
}

function isBlocked(factors, quote, routeVenues) {
  const priceImpact = Number(quote.priceImpactPct || "0");
  return (
    routeVenues.some((venue) => PANIC_VENUES.has(venue.toLowerCase())) ||
    priceImpact > 5 ||
    factors.some((factor) => factor.id === "liquidity" && factor.score >= 40) &&
      factors.some((factor) => factor.id === "price-shock" && factor.score >= 20)
  );
}

function summarizeRisk(factors, blocked) {
  const top = factors.filter((factor) => factor.score > 0).slice(0, 2).map((factor) => factor.title);
  if (blocked) {
    return "The route is in a blocked posture because multiple market stress factors are stacking at once.";
  }
  if (top.includes("Fresh pool") && top.includes("Shallow liquidity")) {
    return "Fresh and shallow liquidity make this pair vulnerable to slippage and fast exits.";
  }
  if (top.includes("Sell pressure") && top.includes("Price shock")) {
    return "Sell pressure and price shock are rising together, so execution quality can break quickly.";
  }
  return top.length
    ? `${top.join(" + ")} are the main reasons this pair is climbing the watch board.`
    : "No major market stress factors are active on this pair right now.";
}

function buildNextAction(score, blocked) {
  if (blocked) {
    return "Treat this pair as blocked. Hold execution and move to Protect if you already have exposure.";
  }
  if (score >= 75) {
    return "Review immediately. Keep Protect ready before using this route.";
  }
  if (score >= 50) {
    return "Review the route detail and prefer safer venues or smaller size before trading.";
  }
  if (score >= 25) {
    return "Monitor this pair. It is deteriorating but not yet broken.";
  }
  return "Conditions look stable right now. Keep monitoring for changes.";
}

function detailLiquidity(liquidityUsd) {
  if (liquidityUsd === null) return "Primary liquidity is unknown.";
  return `$${Math.round(liquidityUsd).toLocaleString()} liquidity on the observed pair.`;
}

function detailFreshness(pairCreatedAt, now) {
  if (pairCreatedAt === null) return "Pool age is unknown.";
  const hours = (now.getTime() - pairCreatedAt) / 3_600_000;
  return `${hours.toFixed(1)}h since creation.`;
}

function flowDetail(sells, buys) {
  if (sells === null || buys === null) return "Short-term trade flow is unavailable.";
  return `${sells} sells vs ${buys} buys over the last 5m.`;
}

function riskLevelFromScore(score) {
  if (score >= 75) return "critical";
  if (score >= 50) return "elevated";
  if (score >= 25) return "watch";
  return "clear";
}

function statusRank(status) {
  switch (status) {
    case "blocked":
      return 3;
    case "warn":
      return 2;
    default:
      return 1;
  }
}

function worseStatus(left, right) {
  return statusRank(left) >= statusRank(right) ? left : right;
}

function sortMarketRiskItems(items) {
  return [...items].sort((a, b) => {
    const statusDiff = statusRank(b.status) - statusRank(a.status);
    if (statusDiff !== 0) return statusDiff;
    const riskDiff = b.score - a.score;
    if (riskDiff !== 0) return riskDiff;
    return b.importanceScore - a.importanceScore;
  });
}

function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Number(value).toFixed(1)}%`;
}

function formatImpact(value) {
  if (!Number.isFinite(value)) return "n/a";
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute < 0.01) return "<0.01%";
  if (absolute < 0.1) return `${absolute.toFixed(3)}%`;
  return `${absolute.toFixed(2)}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  createWatchService,
  TOKEN_UNIVERSE,
  sortMarketRiskItems,
  summarizeRiskThemes,
  summarizeRiskVenues,
  summarizeTokenHealth,
};
