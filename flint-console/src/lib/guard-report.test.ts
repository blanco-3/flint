import { strict as assert } from "assert";

import { demoScenarioById, buildDemoComparison, getDemoOrders } from "./guard-demo";
import { buildIncidentPack, mergePolicyWithIncident } from "./guard-incident";
import { POLICY_PRESETS } from "./guard-policies";
import { evaluateTriggerOrders } from "./guard-risk";
import { buildDecisionReport, buildPanicActionPlan } from "./guard-report";

describe("guard decision reporting", () => {
  it("recommends a safer route when a safe fallback exists", () => {
    const scenario = demoScenarioById("fresh-pool-rug");
    const policy = POLICY_PRESETS.retail;
    const comparison = buildDemoComparison("fresh-pool-rug", policy, true);
    const incidentPack = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "fresh-pool-rug",
      policyPreset: "retail",
      policy,
      safeMode: true,
      panicMode: false,
      signals: scenario.signals,
      comparison,
    });

    const report = buildDecisionReport({
      actionProfileId: "retail-user",
      incidentPack,
      comparison,
      orderAssessments: [],
    });

    assert.equal(report.executionRecommendation, "prefer-safe-route");
    assert.equal(report.posture, "caution");
  });

  it("builds a panic action plan with candidate orders under a critical incident", () => {
    const scenario = demoScenarioById("venue-panic");
    const policy = POLICY_PRESETS.retail;
    const comparison = buildDemoComparison("venue-panic", policy, true);
    const incidentPack = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "venue-panic",
      policyPreset: "retail",
      policy,
      safeMode: true,
      panicMode: true,
      signals: scenario.signals,
      comparison,
    });
    const incidentAwarePolicy = mergePolicyWithIncident(policy, incidentPack);
    const orders = getDemoOrders("venue-panic");
    const orderAssessments = evaluateTriggerOrders(orders, incidentAwarePolicy, true);

    const plan = buildPanicActionPlan({
      actionProfileId: "retail-user",
      incidentPack,
      comparison,
      orderAssessments,
    });

    assert.equal(plan.severity, "critical");
    assert.ok(plan.candidateOrderKeys.length > 0);
  });
});
