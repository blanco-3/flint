import { strict as assert } from "assert";

import { parseDeterministicAuditBundle, summarizeImportedBundle } from "./guard-bundle";
import { buildDeterministicAuditBundle } from "./guard-audit";
import { buildDemoComparison, demoScenarioById } from "./guard-demo";
import { buildIncidentPack } from "./guard-incident";
import { POLICY_PRESETS } from "./guard-policies";
import { buildDecisionReport, buildPanicActionPlan } from "./guard-report";

describe("guard bundle parsing", () => {
  it("parses a deterministic audit bundle", () => {
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

    const parsed = parseDeterministicAuditBundle(bundle);
    assert.equal(parsed.bundleId, bundle.bundleId);
    const summary = summarizeImportedBundle(parsed);
    assert.equal(summary.severity, incidentPack.severity);
  });

  it("rejects malformed bundle payloads", () => {
    assert.throws(() => parseDeterministicAuditBundle({ foo: "bar" }), /invalid_version/);
  });

  it("rejects wrong-version bundles", () => {
    assert.throws(
      () =>
        parseDeterministicAuditBundle({
          version: "2",
          bundleId: "bundle-1",
          incidentPack: {},
          decisionReport: {},
          panicActionPlan: {},
          comparison: null,
          ordersLoaded: false,
          selectedOrderKeys: [],
          activityLog: [],
        }),
      /invalid_version/
    );
  });

  it("rejects malformed nested decision report payloads", () => {
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

    const malformed = {
      ...bundle,
      decisionReport: {
        ...bundle.decisionReport,
        nextActions: "not-an-array",
      },
    };

    assert.throws(
      () => parseDeterministicAuditBundle(malformed),
      /invalid_decisionReport_nextActions/
    );
  });
});
