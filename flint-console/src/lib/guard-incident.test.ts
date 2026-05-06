import { strict as assert } from "assert";

import { demoScenarioById } from "./guard-demo";
import { buildIncidentPack, mergePolicyWithIncident } from "./guard-incident";
import { POLICY_PRESETS } from "./guard-policies";

describe("guard incident pack", () => {
  it("builds a seeded demo incident pack from scenario state", () => {
    const scenario = demoScenarioById("venue-panic");
    const incidentPack = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "venue-panic",
      policyPreset: "retail",
      policy: POLICY_PRESETS.retail,
      safeMode: true,
      panicMode: true,
      signals: scenario.signals,
      comparison: null,
    });

    assert.equal(incidentPack.source, "demo");
    assert.equal(incidentPack.severity, "critical");
    assert.equal(incidentPack.affectedVenues[0], "zerofi");
  });

  it("merges incident data into policy without losing existing policy values", () => {
    const scenario = demoScenarioById("fresh-pool-rug");
    const incidentPack = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "fresh-pool-rug",
      policyPreset: "treasury",
      policy: POLICY_PRESETS.treasury,
      safeMode: true,
      panicMode: false,
      signals: scenario.signals,
      comparison: null,
    });

    const merged = mergePolicyWithIncident(POLICY_PRESETS.treasury, incidentPack);
    assert.ok(merged.panicVenues.includes("pumpswap"));
    assert.ok(merged.denylistVenues.includes("pumpswap"));
  });

  it("changes incident id when execution posture changes materially", () => {
    const scenario = demoScenarioById("fresh-pool-rug");
    const calm = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "fresh-pool-rug",
      policyPreset: "retail",
      policy: POLICY_PRESETS.retail,
      safeMode: true,
      panicMode: false,
      signals: scenario.signals,
      comparison: null,
    });
    const critical = buildIncidentPack({
      dataMode: "demo",
      demoScenario: scenario,
      demoScenarioId: "fresh-pool-rug",
      policyPreset: "retail",
      policy: POLICY_PRESETS.retail,
      safeMode: true,
      panicMode: true,
      signals: scenario.signals,
      comparison: null,
    });

    assert.notEqual(calm.id, critical.id);
  });
});
