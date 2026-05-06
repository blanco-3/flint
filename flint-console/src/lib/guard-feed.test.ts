import { strict as assert } from "assert";

import { buildDeterministicAuditBundle } from "./guard-audit";
import { buildDemoComparison, demoScenarioById } from "./guard-demo";
import { buildSafetyFeedItem, buildSafetyFeedSnapshot } from "./guard-feed";
import { buildIncidentPack } from "./guard-incident";
import { POLICY_PRESETS } from "./guard-policies";
import { buildDecisionReport, buildPanicActionPlan } from "./guard-report";

describe("guard safety feed", () => {
  it("builds a feed item from a deterministic bundle", () => {
    const scenario = demoScenarioById("fresh-pool-rug");
    const comparison = buildDemoComparison("fresh-pool-rug", POLICY_PRESETS.retail, true);
    const incidentPack = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "fresh-pool-rug",
      policyPreset: "retail",
      policy: POLICY_PRESETS.retail,
      safeMode: true,
      panicMode: false,
      signals: scenario.signals,
      comparison,
    });
    const decisionReport = buildDecisionReport({
      actionProfileId: "retail-user",
      incidentPack,
      comparison,
      orderAssessments: [],
    });
    const panicActionPlan = buildPanicActionPlan({
      actionProfileId: "retail-user",
      incidentPack,
      comparison,
      orderAssessments: [],
    });
    const bundle = buildDeterministicAuditBundle({
      incidentPack,
      decisionReport,
      panicActionPlan,
      comparison,
      ordersLoaded: false,
      selectedOrderKeys: [],
      activityLog: [],
    });

    const item = buildSafetyFeedItem({
      bundle,
      incidentPack,
      decisionReport,
      panicActionPlan,
      profile: "retail-user",
    });

    assert.equal(item.incidentId, incidentPack.id);
    assert.equal(item.bundleId, bundle.bundleId);
  });

  it("summarizes a feed snapshot", () => {
    const snapshot = buildSafetyFeedSnapshot([
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
        blockedRoute: false,
        affectedTokens: [],
        affectedPairs: [],
        affectedVenues: [],
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
        affectedTokens: [],
        affectedPairs: [],
        affectedVenues: [],
        nextActions: [],
      },
    ]);

    assert.equal(snapshot.itemCount, 2);
    assert.equal(snapshot.criticalCount, 1);
    assert.equal(snapshot.degradedCount, 1);
  });
});
