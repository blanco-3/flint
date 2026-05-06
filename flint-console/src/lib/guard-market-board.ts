import type {
  MarketRiskItem,
  MarketRiskTheme,
  MarketTokenHealth,
  MarketVenueHealth,
} from "./guard-types";

export function sortMarketRiskItems(items: MarketRiskItem[]) {
  return [...items].sort((a, b) => {
    const statusRankDiff = statusRank(b.status) - statusRank(a.status);
    if (statusRankDiff !== 0) return statusRankDiff;
    return a.score - b.score;
  });
}

export function summarizeRiskVenues(items: MarketRiskItem[]) {
  const counts = new Map<
    string,
    { count: number; blockedCount: number; warnCount: number; status: MarketVenueHealth["status"] }
  >();
  for (const item of items) {
    for (const venue of item.venues.length ? item.venues : [item.venue]) {
      const current = counts.get(venue) ?? {
        count: 0,
        blockedCount: 0,
        warnCount: 0,
        status: "safe" as const,
      };
      current.count += 1;
      if (item.status === "blocked") current.blockedCount += 1;
      if (item.status === "warn") current.warnCount += 1;
      current.status = worseStatus(current.status, item.status);
      counts.set(venue, current);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      const statusDiff = statusRank(b[1].status) - statusRank(a[1].status);
      if (statusDiff !== 0) return statusDiff;
      return b[1].count - a[1].count || a[0].localeCompare(b[0]);
    })
    .slice(0, 5)
    .map(([venue, value]) => ({
      venue,
      count: value.count,
      blockedCount: value.blockedCount,
      warnCount: value.warnCount,
      status: value.status,
    }));
}

export function summarizeTokenHealth(items: MarketRiskItem[]) {
  const tokens = new Map<
    string,
    {
      status: MarketTokenHealth["status"];
      scoreSum: number;
      pairKeys: Set<string>;
      venues: Set<string>;
      reasons: Map<string, number>;
    }
  >();

  for (const item of items) {
    for (const symbol of [item.inputSymbol, item.outputSymbol]) {
      const current = tokens.get(symbol) ?? {
        status: "safe" as const,
        scoreSum: 0,
        pairKeys: new Set<string>(),
        venues: new Set<string>(),
        reasons: new Map<string, number>(),
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
    .sort((a, b) => {
      const statusDiff = statusRank(b.status) - statusRank(a.status);
      if (statusDiff !== 0) return statusDiff;
      return a.averageScore - b.averageScore || a.symbol.localeCompare(b.symbol);
    });
}

export function summarizeRiskThemes(items: MarketRiskItem[]) {
  const themes = new Map<string, { count: number; status: MarketRiskTheme["status"] }>();
  for (const item of items) {
    for (const title of item.reasonTitles) {
      const current = themes.get(title) ?? {
        count: 0,
        status: "safe" as const,
      };
      current.count += 1;
      current.status = worseStatus(current.status, item.status);
      themes.set(title, current);
    }
  }
  return [...themes.entries()]
    .map(([title, value]) => ({
      title,
      count: value.count,
      status: value.status,
    }))
    .sort((a, b) => {
      const statusDiff = statusRank(b.status) - statusRank(a.status);
      if (statusDiff !== 0) return statusDiff;
      return b.count - a.count || a.title.localeCompare(b.title);
    })
    .slice(0, 6);
}

function statusRank(status: MarketRiskItem["status"]) {
  switch (status) {
    case "blocked":
      return 3;
    case "warn":
      return 2;
    case "safe":
      return 1;
  }
}

function worseStatus(
  left: MarketRiskItem["status"],
  right: MarketRiskItem["status"]
): MarketRiskItem["status"] {
  return statusRank(left) >= statusRank(right) ? left : right;
}
