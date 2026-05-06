import type {
  ActionProfileId,
  DecisionReport,
  DeterministicAuditBundle,
  IncidentPack,
  PanicActionPlan,
  SafetyFeedItem,
} from "./guard-types";

export function buildSafetyFeedItem(input: {
  bundle: DeterministicAuditBundle;
  incidentPack: IncidentPack;
  decisionReport: DecisionReport;
  panicActionPlan: PanicActionPlan;
  profile: ActionProfileId;
}): SafetyFeedItem {
  const { bundle, incidentPack, decisionReport, panicActionPlan, profile } = input;
  return {
    incidentId: incidentPack.id,
    bundleId: bundle.bundleId,
    profile,
    severity: incidentPack.severity,
    posture: decisionReport.posture,
    executionRecommendation: decisionReport.executionRecommendation,
    headline: decisionReport.headline,
    summary: panicActionPlan.summary,
    candidateOrderCount: panicActionPlan.candidateOrderKeys.length,
    blockedRoute: panicActionPlan.blockedRoute,
    affectedTokens: [...incidentPack.affectedTokens],
    affectedPairs: [...incidentPack.affectedPairs],
    affectedVenues: [...incidentPack.affectedVenues],
    nextActions: [...decisionReport.nextActions],
  };
}

export function buildSafetyFeedSnapshot(items: SafetyFeedItem[]) {
  return {
    itemCount: items.length,
    criticalCount: items.filter((item) => item.severity === "critical").length,
    degradedCount: items.filter((item) => item.posture === "degraded").length,
    blockedCount: items.filter((item) => item.blockedRoute).length,
    items: [...items].sort((a, b) => a.incidentId.localeCompare(b.incidentId)),
  };
}
