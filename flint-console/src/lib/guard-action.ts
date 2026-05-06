import type { ActionProfile, ActionProfileId } from "./guard-types";

export const ACTION_PROFILES: Record<ActionProfileId, ActionProfile> = {
  "retail-user": {
    id: "retail-user",
    label: "Retail user",
    description: "Bias toward simple stop/go guidance and safer route recommendations.",
    executionBias: "user-safe",
  },
  "treasury-operator": {
    id: "treasury-operator",
    label: "Treasury operator",
    description: "Bias toward halting execution and requiring explicit review.",
    executionBias: "operator-review",
  },
  "bot-executor": {
    id: "bot-executor",
    label: "Bot executor",
    description: "Bias toward machine-readable rejection or fallback directives.",
    executionBias: "system-reject",
  },
  "partner-app": {
    id: "partner-app",
    label: "Partner app",
    description: "Bias toward embeddable route and risk advice for downstream apps.",
    executionBias: "user-safe",
  },
};

export function defaultActionProfileForPreset(preset: "retail" | "treasury"): ActionProfileId {
  return preset === "treasury" ? "treasury-operator" : "retail-user";
}

export function tailorActionsForProfile(
  profileId: ActionProfileId,
  nextActions: string[]
) {
  const profile = ACTION_PROFILES[profileId];
  const actions = [...nextActions];

  switch (profile.executionBias) {
    case "operator-review":
      return actions.map((action) =>
        action.includes("Export")
          ? action
          : `${action} Escalate to operator review before resuming size.`
      );
    case "system-reject":
      return actions.map((action) =>
        action.includes("Stop")
          ? `${action} Emit machine-readable rejection code to the caller.`
          : action
      );
    default:
      return actions;
  }
}
