import { tailorActionsForProfile } from "./guard-action";
import type {
  ActionProfileId,
  DecisionPosture,
  DecisionReport,
  IncidentPack,
  OrderAssessment,
  QuoteComparison,
  RouteRiskReason,
} from "./guard-types";

type BuildDecisionReportInput = {
  actionProfileId: ActionProfileId;
  incidentPack: IncidentPack;
  comparison: QuoteComparison | null;
  orderAssessments: OrderAssessment[];
};

export function buildDecisionReport(input: BuildDecisionReportInput): DecisionReport {
  const routeReasons = input.comparison
    ? input.comparison.baseAssessment.reasons.concat(input.comparison.safeAssessment?.reasons ?? [])
    : [];
  const orderReasons = input.orderAssessments.flatMap((item) => item.reasons);
  const reasons = dedupeReasons(routeReasons.concat(orderReasons));
  const posture = derivePosture(input.incidentPack, input.comparison, input.orderAssessments);
  const executionRecommendation = deriveExecutionRecommendation(input.comparison);
  const candidateCount = input.orderAssessments.filter((item) => item.candidate).length;

  return {
    headline: buildHeadline(posture, input.comparison, candidateCount),
    posture,
    executionRecommendation,
    routeSummary: buildRouteSummary(input.comparison),
    orderSummary:
      candidateCount > 0
        ? `${candidateCount} trigger order(s) should be reviewed or unwound under the active incident pack.`
        : "No trigger orders currently require panic remediation.",
    reasons,
    nextActions: tailorActionsForProfile(
      input.actionProfileId,
      buildNextActions(posture, executionRecommendation, candidateCount)
    ),
  };
}

export function buildPanicActionPlan(input: BuildDecisionReportInput) {
  const candidateOrderKeys = input.orderAssessments
    .filter((item) => item.candidate)
    .map((item) => item.order.orderKey)
    .sort();
  const blockedRoute = input.comparison?.executionTarget === "none";

  return {
    severity: input.incidentPack.severity,
    summary: blockedRoute
      ? "Route execution is blocked; prioritize unwinding exposed orders."
      : candidateOrderKeys.length
        ? "Execution can continue cautiously, but risky trigger orders should be cleaned up first."
        : "No immediate unwind is required. Keep monitoring and export the current audit state.",
    candidateOrderKeys,
    blockedRoute,
    nextSteps: tailorActionsForProfile(
      input.actionProfileId,
      buildNextActions(
        derivePosture(input.incidentPack, input.comparison, input.orderAssessments),
        deriveExecutionRecommendation(input.comparison),
        candidateOrderKeys.length
      )
    ),
  };
}

function derivePosture(
  incidentPack: IncidentPack,
  comparison: QuoteComparison | null,
  orderAssessments: OrderAssessment[]
): DecisionPosture {
  const candidateCount = orderAssessments.filter((item) => item.candidate).length;
  if (comparison?.executionTarget === "none") return "blocked";
  if (incidentPack.severity === "critical" || candidateCount > 0) return "degraded";
  if (comparison?.executionTarget === "safe" || comparison?.baseAssessment.status === "warn") {
    return "caution";
  }
  return "clear";
}

function deriveExecutionRecommendation(comparison: QuoteComparison | null) {
  if (!comparison) return "allow-best-route";
  if (comparison.executionTarget === "none") return "block-execution";
  if (comparison.executionTarget === "safe") return "prefer-safe-route";
  return "allow-best-route";
}

function buildHeadline(
  posture: DecisionPosture,
  comparison: QuoteComparison | null,
  candidateCount: number
) {
  if (posture === "blocked") {
    return "Flint is blocking execution under the current incident conditions.";
  }
  if (posture === "degraded") {
    return candidateCount > 0
      ? "Flint recommends unwinding risky open orders before increasing exposure."
      : "Flint recommends heightened caution and safer execution posture.";
  }
  if (comparison?.executionTarget === "safe") {
    return "Flint found a safer route and recommends using it instead of the raw market path.";
  }
  return "Flint sees no active blocker, but the current route should still be documented.";
}

function buildRouteSummary(comparison: QuoteComparison | null) {
  if (!comparison) return "No quote has been evaluated yet.";
  if (comparison.executionTarget === "none") {
    return "Both the raw market route and the current fallback path are below the active safety bar.";
  }
  if (comparison.executionTarget === "safe") {
    return "The raw route degraded under the active policy, and Flint found a safer fallback path.";
  }
  return "The raw market route cleared the active policy and remains executable.";
}

function buildNextActions(
  posture: DecisionPosture,
  executionRecommendation: DecisionReport["executionRecommendation"],
  candidateCount: number
) {
  const actions: string[] = [];
  if (executionRecommendation === "block-execution") {
    actions.push("Stop fresh swap execution until the incident pack is cleared or safer liquidity appears.");
  }
  if (executionRecommendation === "prefer-safe-route") {
    actions.push("Use the Flint-filtered safer route instead of the best-price route.");
  }
  if (candidateCount > 0) {
    actions.push(`Review and cancel ${candidateCount} panic candidate order(s).`);
  }
  if (posture === "clear") {
    actions.push("Export the audit bundle to preserve a baseline decision trace.");
  } else {
    actions.push("Export the decision report and incident pack for operator review.");
  }
  return actions;
}

function dedupeReasons(reasons: RouteRiskReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    if (seen.has(reason.id)) return false;
    seen.add(reason.id);
    return true;
  });
}
