import type {
  IncidentSeverity,
  SafetyFeedItem,
  WatchSnapshot,
  WatchlistMatch,
  WatchlistState,
} from "./guard-types";

export function buildWatchSnapshot(items: SafetyFeedItem[]): WatchSnapshot {
  return {
    activeIncidentCount: items.length,
    criticalIncidentCount: items.filter((item) => item.severity === "critical").length,
    degradedIncidentCount: items.filter((item) => item.posture === "degraded").length,
    blockedRouteCount: items.filter((item) => item.blockedRoute).length,
  };
}

export function buildWatchlistMatches(
  watchlist: WatchlistState,
  items: SafetyFeedItem[]
): WatchlistMatch[] {
  const matches: WatchlistMatch[] = [];

  for (const token of watchlist.tokens) {
    matches.push(buildMatch("token", token, items, (item) => item.affectedTokens.includes(token)));
  }
  for (const pair of watchlist.pairs) {
    matches.push(buildMatch("pair", pair, items, (item) => item.affectedPairs.includes(pair)));
  }
  for (const venue of watchlist.venues) {
    matches.push(buildMatch("venue", venue, items, (item) => item.affectedVenues.includes(venue)));
  }

  return matches.sort((a, b) => {
    const severityDiff = severityRank(b.highestSeverity) - severityRank(a.highestSeverity);
    if (severityDiff !== 0) return severityDiff;
    return a.value.localeCompare(b.value);
  });
}

function buildMatch(
  kind: WatchlistMatch["kind"],
  value: string,
  items: SafetyFeedItem[],
  predicate: (item: SafetyFeedItem) => boolean
): WatchlistMatch {
  const overlaps = items.filter(predicate);
  const highestSeverity =
    overlaps.reduce<IncidentSeverity | null>((current, item) => {
      if (!current) return item.severity;
      return severityRank(item.severity) > severityRank(current) ? item.severity : current;
    }, null) ?? null;

  return {
    kind,
    value,
    overlapCount: overlaps.length,
    highestSeverity,
    overlappingIncidentIds: overlaps.map((item) => item.incidentId),
  };
}

function severityRank(severity: IncidentSeverity | null) {
  switch (severity) {
    case "critical":
      return 3;
    case "elevated":
      return 2;
    case "watch":
      return 1;
    default:
      return 0;
  }
}
