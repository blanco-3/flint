import { strict as assert } from "assert";

import { demoScenarioById } from "./guard-demo";
import { deriveModeSessionState } from "./guard-session";

describe("guard session mode state", () => {
  it("hydrates seeded demo state from the active scenario", () => {
    const scenario = demoScenarioById("venue-panic");
    const state = deriveModeSessionState({
      nextMode: "demo",
      activeScenario: scenario,
      defaultForm: {
        inputMint: "a",
        outputMint: "b",
        amount: "1",
        slippageBps: 75,
      },
    });

    assert.equal(state.form.inputMint, scenario.form.inputMint);
    assert.equal(state.policyPreset, "retail");
    assert.equal(state.actionProfileId, "retail-user");
  });

  it("resets to clean live defaults when leaving demo mode", () => {
    const scenario = demoScenarioById("fresh-pool-rug");
    const state = deriveModeSessionState({
      nextMode: "live",
      activeScenario: scenario,
      defaultForm: {
        inputMint: "default-in",
        outputMint: "default-out",
        amount: "1",
        slippageBps: 75,
      },
    });

    assert.equal(state.form.inputMint, "default-in");
    assert.equal(state.signals.tokens.length, 0);
    assert.equal(state.policyPreset, "retail");
    assert.equal(state.actionProfileId, "retail-user");
  });
});
