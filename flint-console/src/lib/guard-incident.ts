import { policyCopy } from "./guard-policies";
import type {
  DemoScenario,
  DemoScenarioId,
  GuardDataMode,
  GuardPolicyPreset,
  IncidentPack,
  IncidentSeverity,
  QuoteComparison,
  RiskPolicy,
  RiskSignalInputs,
} from "./guard-types";

type BuildIncidentPackInput = {
  dataMode: GuardDataMode;
  demoScenario: DemoScenario;
  demoScenarioId: DemoScenarioId;
  policyPreset: GuardPolicyPreset;
  policy: RiskPolicy;
  safeMode: boolean;
  panicMode: boolean;
  signals: RiskSignalInputs;
  comparison: QuoteComparison | null;
};

export function buildIncidentPack(input: BuildIncidentPackInput): IncidentPack {
  const severity = deriveIncidentSeverity(input);
  const source = input.dataMode === "demo" ? "demo" : hasSignals(input.signals) ? "manual" : "live-session";
  const affectedTokens = dedupeAndSort(input.signals.tokens);
  const affectedPairs = dedupeAndSort(input.signals.pairs);
  const affectedVenues = dedupeAndSort(input.signals.venues);

  const name =
    input.dataMode === "demo"
      ? input.demoScenario.label
      : affectedTokens.length || affectedPairs.length || affectedVenues.length
        ? "Manual incident watch"
        : "Baseline execution watch";

  return {
    id: buildIncidentId(
      input.dataMode,
      input.demoScenarioId,
      input.policyPreset,
      input.safeMode,
      input.panicMode,
      severity,
      input.comparison?.executionTarget ?? "unscored",
      affectedTokens,
      affectedPairs,
      affectedVenues
    ),
    name,
    source,
    severity,
    createdAt: input.dataMode === "demo" ? "demo-seeded" : "live-session",
    summary: buildIncidentSummary(input, severity),
    recommendedAction: buildRecommendedAction(input, severity),
    mode: input.dataMode,
    scenarioId: input.dataMode === "demo" ? input.demoScenarioId : null,
    policyPreset: input.policyPreset,
    safeMode: input.safeMode,
    panicMode: input.panicMode,
    affectedTokens,
    affectedPairs,
    affectedVenues,
  };
}

export function mergePolicyWithIncident(policy: RiskPolicy, incidentPack: IncidentPack) {
  const next = policyCopy(policy);
  next.flaggedTokens = dedupeAndSort(next.flaggedTokens.concat(incidentPack.affectedTokens));
  next.panicTokens = dedupeAndSort(next.panicTokens.concat(incidentPack.affectedTokens));
  next.panicPairs = dedupeAndSort(next.panicPairs.concat(incidentPack.affectedPairs));
  next.panicVenues = dedupeAndSort(next.panicVenues.concat(incidentPack.affectedVenues));
  return next;
}

function deriveIncidentSeverity(input: BuildIncidentPackInput): IncidentSeverity {
  if (input.comparison?.executionTarget === "none") return "critical";
  if (input.panicMode) return "critical";
  if (input.signals.tokens.length || input.signals.pairs.length || input.signals.venues.length) {
    return "elevated";
  }
  if (input.comparison?.baseAssessment.status === "blocked") return "elevated";
  return "watch";
}

function buildIncidentSummary(input: BuildIncidentPackInput, severity: IncidentSeverity) {
  if (input.dataMode === "demo") {
    return input.demoScenario.summary;
  }
  if (severity === "critical") {
    return "Execution is operating under incident conditions. Flint should prefer unwind and fail-closed behavior.";
  }
  if (severity === "elevated") {
    return "Execution risk signals are active. Flint should explain decisions and bias toward safer alternatives.";
  }
  return "No active incident pack is loaded. Flint is monitoring the route and order surface for abnormal conditions.";
}

function buildRecommendedAction(input: BuildIncidentPackInput, severity: IncidentSeverity) {
  if (input.comparison?.executionTarget === "none") {
    return "Do not execute. Review the incident pack and remove risky exposure before retrying.";
  }
  if (severity === "critical") {
    return "Prefer safer routes and cancel exposed trigger orders before taking fresh risk.";
  }
  if (severity === "elevated") {
    return "Review the decision report before executing and keep panic candidates ready.";
  }
  return "Baseline watch mode. Compare routes normally and export an audit bundle if conditions change.";
}

function buildIncidentId(
  dataMode: GuardDataMode,
  demoScenarioId: DemoScenarioId,
  policyPreset: GuardPolicyPreset,
  safeMode: boolean,
  panicMode: boolean,
  severity: IncidentSeverity,
  executionTarget: string,
  tokens: string[],
  pairs: string[],
  venues: string[]
) {
  return [
    "incident",
    dataMode,
    dataMode === "demo" ? demoScenarioId : "live",
    policyPreset,
    safeMode ? "safe" : "unsafe",
    panicMode ? "panic" : "calm",
    severity,
    executionTarget,
    tokens.join(","),
    pairs.join(","),
    venues.join(","),
  ].join(":");
}

function hasSignals(signals: RiskSignalInputs) {
  return signals.tokens.length > 0 || signals.pairs.length > 0 || signals.venues.length > 0;
}

function dedupeAndSort(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
