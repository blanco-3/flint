import {
  canonicalMint,
  canonicalPairKey,
  canonicalVenue,
} from "./guard-policies";
import type {
  JupiterQuote,
  PoolSnapshot,
  RiskPolicy,
  RouteAssessment,
  RouteHopAssessment,
  RouteRiskReason,
  TriggerOrder,
} from "./guard-types";

export function evaluateQuoteRisk(
  quote: JupiterQuote,
  pools: Record<string, PoolSnapshot>,
  policy: RiskPolicy
): RouteAssessment {
  const reasons: RouteRiskReason[] = [];
  const blockedVenues = new Set<string>();
  const flaggedTokens = new Set<string>();
  const denylistedVenueSet = new Set(policy.denylistVenues.map(canonicalVenue));
  const panicVenueSet = new Set(policy.panicVenues.map(canonicalVenue));
  const flaggedTokenSet = new Set(policy.flaggedTokens);
  const panicTokenSet = new Set(policy.panicTokens);
  const panicPairSet = new Set(policy.panicPairs);

  if (!quote.routePlan.length) {
    reasons.push(reason("route-empty", "Route unavailable", "No route plan was returned.", true, "high", "route", "route"));
  }

  const priceImpact = Number(quote.priceImpactPct);
  if (Number.isFinite(priceImpact) && priceImpact > policy.maxPriceImpactPct) {
    reasons.push(
      reason(
        "price-impact",
        "Price impact too high",
        `Impact ${priceImpact}% exceeds ${policy.maxPriceImpactPct}% for ${policy.label}.`,
        true,
        "high",
        "route",
        "route"
      )
    );
  }

  if (quote.routePlan.length > policy.maxHops) {
    reasons.push(
      reason(
        "hop-count",
        "Too many hops",
        `Route uses ${quote.routePlan.length} hops while ${policy.label} allows ${policy.maxHops}.`,
        true,
        "medium",
        "route",
        "route"
      )
    );
  }

  const hops: RouteHopAssessment[] = quote.routePlan.map((hop, index) => {
    const hopReasons: RouteRiskReason[] = [];
    const label = hop.swapInfo.label || "Unknown";
    const venueKey = canonicalVenue(label);
    const inputMint = canonicalMint(hop.swapInfo.inputMint);
    const outputMint = canonicalMint(hop.swapInfo.outputMint);
    const pairKey = canonicalPairKey(inputMint, outputMint);
    const pool = pools[hop.swapInfo.ammKey];

    if (denylistedVenueSet.has(venueKey)) {
      hopReasons.push(
        reason(
          `denylist-${index}`,
          "Venue denylisted",
          `${label} is denylisted by the active policy preset.`,
          true,
          "high",
          "venue",
          label
        )
      );
      blockedVenues.add(label);
    }

    if (panicVenueSet.has(venueKey)) {
      hopReasons.push(
        reason(
          `panic-venue-${index}`,
          "Panic venue signal",
          `${label} was manually marked as unsafe for the current incident.`,
          true,
          "high",
          "venue",
          label
        )
      );
      blockedVenues.add(label);
    }

    if (flaggedTokenSet.has(inputMint) || panicTokenSet.has(inputMint)) {
      flaggedTokens.add(inputMint);
      hopReasons.push(
        reason(
          `flagged-input-${index}`,
          "Flagged token",
          `Input mint ${inputMint} is marked unsafe by policy or panic signal.`,
          true,
          "high",
          "token",
          inputMint
        )
      );
    }

    if (flaggedTokenSet.has(outputMint) || panicTokenSet.has(outputMint)) {
      flaggedTokens.add(outputMint);
      hopReasons.push(
        reason(
          `flagged-output-${index}`,
          "Flagged token",
          `Output mint ${outputMint} is marked unsafe by policy or panic signal.`,
          true,
          "high",
          "token",
          outputMint
        )
      );
    }

    if (panicPairSet.has(pairKey)) {
      hopReasons.push(
        reason(
          `panic-pair-${index}`,
          "Panic pair signal",
          "The active incident list explicitly blocks this token pair.",
          true,
          "high",
          "route",
          pairKey
        )
      );
    }

    if (pool && pool.pairCreatedAt) {
      const ageHours = (Date.now() - pool.pairCreatedAt) / 3_600_000;
      if (ageHours < policy.minPoolAgeHours) {
        hopReasons.push(
          reason(
            `young-pool-${index}`,
            "Pool too new",
            `${label} pool is only ${ageHours.toFixed(1)}h old; policy requires ${policy.minPoolAgeHours}h.`,
            true,
            "high",
            "hop",
            hop.swapInfo.ammKey
          )
        );
      }
    }

    if (pool && typeof pool.liquidityUsd === "number" && pool.liquidityUsd < policy.minLiquidityUsd) {
      hopReasons.push(
        reason(
          `shallow-liquidity-${index}`,
          "Shallow liquidity",
          `${label} liquidity is $${Math.round(pool.liquidityUsd).toLocaleString()} which is below the ${policy.label} threshold.`,
          true,
          "high",
          "hop",
          hop.swapInfo.ammKey
        )
      );
    }

    if (pool && typeof pool.priceChangeH1 === "number" && pool.priceChangeH1 <= policy.maxNegativePriceChangeH1Pct) {
      hopReasons.push(
        reason(
          `price-shock-${index}`,
          "Suspicious price shock",
          `${label} moved ${pool.priceChangeH1}% over 1h, breaching the panic shock threshold.`,
          true,
          "medium",
          "hop",
          hop.swapInfo.ammKey
        )
      );
    }

    if (
      pool &&
      typeof pool.sellsM5 === "number" &&
      typeof pool.buysM5 === "number" &&
      pool.buysM5 > 0 &&
      pool.sellsM5 / pool.buysM5 >= policy.sellPressureRatio
    ) {
      hopReasons.push(
        reason(
          `sell-pressure-${index}`,
          "Sell pressure spike",
          `${label} has a ${pool.sellsM5}:${pool.buysM5} sell-to-buy ratio in the last 5m.`,
          false,
          "medium",
          "hop",
          hop.swapInfo.ammKey
        )
      );
    }

    if (!pool) {
      hopReasons.push(
        reason(
          `unknown-pool-${index}`,
          "Pool metadata unavailable",
          policy.blockMissingPoolMetadata
            ? `Dex Screener did not return metadata for ${label}; ${policy.label} blocks routes with unknown pool metadata.`
            : `Dex Screener did not return metadata for ${label}; Flint keeps this as a warning.`,
          policy.blockMissingPoolMetadata,
          policy.blockMissingPoolMetadata ? "high" : "low",
          "hop",
          hop.swapInfo.ammKey
        )
      );
    }

    reasons.push(...hopReasons);

    if (hopReasons.some((item) => item.blocking)) {
      blockedVenues.add(label);
    }

    return {
      ammKey: hop.swapInfo.ammKey,
      label: label,
      percent: hop.percent,
      reasons: hopReasons,
      liquidityUsdLabel:
        pool && typeof pool.liquidityUsd === "number"
          ? `$${Math.round(pool.liquidityUsd).toLocaleString()} liq`
          : "liq unknown",
      ageLabel:
        pool && pool.pairCreatedAt
          ? `${((Date.now() - pool.pairCreatedAt) / 3_600_000).toFixed(1)}h old`
          : "age unknown",
    };
  });

  const blockingReasons = reasons.filter((item) => item.blocking);
  const score = clamp(
    Math.round(
      100 -
        blockingReasons.length * 22 -
        (reasons.length - blockingReasons.length) * 6 -
        Math.max(Number(quote.priceImpactPct), 0) * 10
    ),
    0,
    100
  );

  return {
    status: blockingReasons.length ? "blocked" : reasons.length ? "warn" : "safe",
    score: score,
    reasons: reasons,
    hops: hops,
    blockedVenues: Array.from(blockedVenues),
    flaggedTokens: Array.from(flaggedTokens),
  };
}

export function evaluateTriggerOrders(
  orders: TriggerOrder[],
  policy: RiskPolicy,
  panicMode: boolean
) {
  return orders.map((order) => {
    const reasons: RouteRiskReason[] = [];
    const orderPair = canonicalPairKey(order.inputMint, order.outputMint);

    if (policy.panicPairs.includes(orderPair)) {
      reasons.push(
        reason(
          `order-pair-${order.orderKey}`,
          "Order touches active incident pair",
          "This trigger order matches the panic pair currently under review.",
          true,
          "high",
          "order",
          order.orderKey
        )
      );
    }

    if (order.venue && policy.panicVenues.includes(canonicalVenue(order.venue))) {
      reasons.push(
        reason(
          `order-venue-${order.orderKey}`,
          "Order venue panic-flagged",
          `The order sits on ${order.venue}, which is currently panic-flagged.`,
          true,
          "high",
          "order",
          order.orderKey
        )
      );
    }

    if (policy.panicTokens.includes(order.inputMint) || policy.panicTokens.includes(order.outputMint)) {
      reasons.push(
        reason(
          `order-token-${order.orderKey}`,
          "Order touches flagged token",
          "The order uses a token that is currently panic-flagged.",
          true,
          "high",
          "order",
          order.orderKey
        )
      );
    }

    if (order.slippageBps && Number(order.slippageBps) >= 1_000) {
      reasons.push(
        reason(
          `order-slippage-${order.orderKey}`,
          "Wide slippage",
          `Order slippage is ${order.slippageBps} bps which is loose for a panic event.`,
          false,
          "medium",
          "order",
          order.orderKey
        )
      );
    }

    return {
      order: order,
      candidate: panicMode && reasons.some((item) => item.blocking),
      reasons: reasons,
    };
  });
}

export function formatPolicySummary(policy: RiskPolicy) {
  return `${policy.minPoolAgeHours}h min age · $${policy.minLiquidityUsd.toLocaleString()} min liq · ${policy.maxHops} hop max`;
}

export function statusTone(status: "safe" | "warn" | "blocked") {
  if (status === "safe") return "safe";
  if (status === "warn") return "warning";
  return "alert";
}

function reason(
  id: string,
  title: string,
  detail: string,
  blocking: boolean,
  severity: "low" | "medium" | "high",
  scope: "route" | "hop" | "token" | "venue" | "order",
  subject: string
): RouteRiskReason {
  return {
    id: id,
    title: title,
    detail: detail,
    blocking: blocking,
    severity: severity,
    scope: scope,
    subject: subject,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
