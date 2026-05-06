import { strict as assert } from "assert";

import { buildDeterministicAuditBundle } from "./guard-audit";
import { buildDemoComparison, demoScenarioById } from "./guard-demo";
import { buildIncidentPack } from "./guard-incident";
import { POLICY_PRESETS } from "./guard-policies";
import { buildDecisionReport, buildPanicActionPlan } from "./guard-report";

describe("guard audit bundle", () => {
  it("produces the same payload for the same state", () => {
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

    const input = {
      incidentPack,
      decisionReport,
      panicActionPlan,
      comparison,
      ordersLoaded: false,
      selectedOrderKeys: [],
      activityLog: [
        {
          id: "log-1",
          createdAt: "2026-05-05T00:00:00.000Z",
          title: "Test",
          detail: "Deterministic",
          severity: "info" as const,
          kind: "activity" as const,
        },
      ],
    };

    const first = JSON.stringify(buildDeterministicAuditBundle(input));
    const second = JSON.stringify(buildDeterministicAuditBundle(input));
    assert.equal(first, second);
  });
});
