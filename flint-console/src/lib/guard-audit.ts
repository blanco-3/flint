import type {
  ActivityLogEntry,
  DecisionReport,
  DeterministicAuditBundle,
  IncidentPack,
  PanicActionPlan,
  QuoteComparison,
} from "./guard-types";

type BuildAuditBundleInput = {
  incidentPack: IncidentPack;
  decisionReport: DecisionReport;
  panicActionPlan: PanicActionPlan;
  comparison: QuoteComparison | null;
  ordersLoaded: boolean;
  selectedOrderKeys: string[];
  activityLog: ActivityLogEntry[];
};

export function buildDeterministicAuditBundle(
  input: BuildAuditBundleInput
): DeterministicAuditBundle {
  const normalizedDecisionReasons = [...input.decisionReport.reasons].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const normalizedNextActions = [...input.decisionReport.nextActions];
  const normalizedCandidateKeys = [...input.panicActionPlan.candidateOrderKeys].sort();
  const normalizedPlanSteps = [...input.panicActionPlan.nextSteps];
  const normalizedSelectedOrderKeys = [...input.selectedOrderKeys].sort();
  const normalizedActivityLog = normalizeActivityLog(input.activityLog);
  const bundleId = buildBundleId({
    incidentPack: {
      ...input.incidentPack,
      affectedTokens: [...input.incidentPack.affectedTokens].sort(),
      affectedPairs: [...input.incidentPack.affectedPairs].sort(),
      affectedVenues: [...input.incidentPack.affectedVenues].sort(),
    },
    decisionReport: {
      ...input.decisionReport,
      reasons: normalizedDecisionReasons,
      nextActions: normalizedNextActions,
    },
    panicActionPlan: {
      ...input.panicActionPlan,
      candidateOrderKeys: normalizedCandidateKeys,
      nextSteps: normalizedPlanSteps,
    },
    comparison: input.comparison,
    ordersLoaded: input.ordersLoaded,
    selectedOrderKeys: normalizedSelectedOrderKeys,
    activityLog: normalizedActivityLog,
  });

  return {
    version: "1",
    bundleId,
    incidentPack: {
      ...input.incidentPack,
      affectedTokens: [...input.incidentPack.affectedTokens].sort(),
      affectedPairs: [...input.incidentPack.affectedPairs].sort(),
      affectedVenues: [...input.incidentPack.affectedVenues].sort(),
    },
    decisionReport: {
      ...input.decisionReport,
      reasons: normalizedDecisionReasons,
      nextActions: normalizedNextActions,
    },
    panicActionPlan: {
      ...input.panicActionPlan,
      candidateOrderKeys: normalizedCandidateKeys,
      nextSteps: normalizedPlanSteps,
    },
    comparison: input.comparison,
    ordersLoaded: input.ordersLoaded,
    selectedOrderKeys: normalizedSelectedOrderKeys,
    activityLog: normalizedActivityLog,
  };
}

function normalizeActivityLog(entries: ActivityLogEntry[]) {
  return [...entries]
    .map((entry) => ({
      ...entry,
      title: entry.title.trim(),
      detail: entry.detail.trim(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function buildBundleId(input: Omit<DeterministicAuditBundle, "version" | "bundleId">) {
  const serialized = stableStringify(input);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `audit:${(hash >>> 0).toString(16)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, inner]) => `${JSON.stringify(key)}:${stableStringify(inner)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
