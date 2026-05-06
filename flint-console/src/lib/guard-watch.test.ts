import { strict as assert } from "assert";

import { buildWatchSnapshot, buildWatchlistMatches } from "./guard-watch";
import type { SafetyFeedItem } from "./guard-types";

describe("guard watch projections", () => {
  const items: SafetyFeedItem[] = [
    {
      incidentId: "a",
      bundleId: "bundle-a",
      profile: "retail-user",
      severity: "critical",
      posture: "degraded",
      executionRecommendation: "prefer-safe-route",
      headline: "A",
      summary: "A",
      candidateOrderCount: 1,
      blockedRoute: true,
      affectedTokens: ["BONK"],
      affectedPairs: ["SOL::BONK"],
      affectedVenues: ["pumpswap"],
      nextActions: [],
    },
    {
      incidentId: "b",
      bundleId: "bundle-b",
      profile: "bot-executor",
      severity: "watch",
      posture: "clear",
      executionRecommendation: "allow-best-route",
      headline: "B",
      summary: "B",
      candidateOrderCount: 0,
      blockedRoute: false,
      affectedTokens: ["USDC"],
      affectedPairs: ["SOL::USDC"],
      affectedVenues: ["raydium"],
      nextActions: [],
    },
  ];

  it("builds watch snapshot counts", () => {
    const snapshot = buildWatchSnapshot(items);
    assert.equal(snapshot.activeIncidentCount, 2);
    assert.equal(snapshot.criticalIncidentCount, 1);
    assert.equal(snapshot.degradedIncidentCount, 1);
    assert.equal(snapshot.blockedRouteCount, 1);
  });

  it("projects watchlist overlaps", () => {
    const matches = buildWatchlistMatches(
      {
        tokens: ["BONK"],
        pairs: ["SOL::USDC"],
        venues: ["pumpswap"],
      },
      items
    );

    assert.equal(matches.length, 3);
    assert.equal(matches[0].highestSeverity, "critical");
    assert.equal(matches[0].overlapCount, 1);
  });
});
