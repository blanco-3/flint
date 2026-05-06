import { strict as assert } from "assert";

import {
  ACTION_PROFILES,
  defaultActionProfileForPreset,
  tailorActionsForProfile,
} from "./guard-action";

describe("guard action profiles", () => {
  it("maps treasury preset to treasury operator by default", () => {
    assert.equal(defaultActionProfileForPreset("treasury"), "treasury-operator");
  });

  it("tailors actions for bot executors", () => {
    const actions = tailorActionsForProfile("bot-executor", [
      "Stop fresh swap execution until the incident pack is cleared or safer liquidity appears.",
    ]);
    assert.ok(actions[0].includes("machine-readable rejection code"));
  });

  it("defines all supported profiles", () => {
    assert.ok(ACTION_PROFILES["retail-user"]);
    assert.ok(ACTION_PROFILES["treasury-operator"]);
    assert.ok(ACTION_PROFILES["bot-executor"]);
    assert.ok(ACTION_PROFILES["partner-app"]);
  });
});
