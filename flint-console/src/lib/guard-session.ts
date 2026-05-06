import { defaultActionProfileForPreset } from "./guard-action";
import type {
  ActionProfileId,
  DemoScenario,
  GuardDataMode,
  GuardPolicyPreset,
  QuoteFormState,
  RiskSignalInputs,
} from "./guard-types";

export function deriveModeSessionState(input: {
  nextMode: GuardDataMode;
  activeScenario: DemoScenario;
  defaultForm: QuoteFormState;
}): {
  form: QuoteFormState;
  signals: RiskSignalInputs;
  policyPreset: GuardPolicyPreset;
  actionProfileId: ActionProfileId;
} {
  if (input.nextMode === "demo") {
    return {
      form: input.activeScenario.form,
      signals: input.activeScenario.signals,
      policyPreset: recommendedPresetForScenario(input.activeScenario.id),
      actionProfileId: defaultActionProfileForPreset(
        recommendedPresetForScenario(input.activeScenario.id)
      ),
    };
  }

  return {
    form: input.defaultForm,
    signals: { tokens: [], pairs: [], venues: [] },
    policyPreset: "retail",
    actionProfileId: defaultActionProfileForPreset("retail"),
  };
}

function recommendedPresetForScenario(id: DemoScenario["id"]): GuardPolicyPreset {
  return id === "unknown-metadata" ? "treasury" : "retail";
}
