import type { DeterministicAuditBundle, SafetyFeedSnapshot } from "./guard-types";

export function parseDeterministicAuditBundle(input: unknown): DeterministicAuditBundle {
  const candidate = assertRecord(input, "bundle");
  assertExactString(candidate.version, "1", "version");
  assertString(candidate.bundleId, "bundleId");
  assertIncidentPack(candidate.incidentPack, "incidentPack");
  assertDecisionReport(candidate.decisionReport, "decisionReport");
  assertPanicActionPlan(candidate.panicActionPlan, "panicActionPlan");
  assertComparison(candidate.comparison, "comparison");
  assertBoolean(candidate.ordersLoaded, "ordersLoaded");
  assertStringArray(candidate.selectedOrderKeys, "selectedOrderKeys");
  assertActivityLogArray(candidate.activityLog, "activityLog");

  return candidate as DeterministicAuditBundle;
}

export function summarizeImportedBundle(bundle: DeterministicAuditBundle) {
  return {
    headline: bundle.decisionReport.headline,
    severity: bundle.incidentPack.severity,
    posture: bundle.decisionReport.posture,
    candidateOrderCount: bundle.panicActionPlan.candidateOrderKeys.length,
  };
}

export function isSafetyFeedSnapshot(input: unknown): input is SafetyFeedSnapshot {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate.itemCount === "number" &&
    typeof candidate.criticalCount === "number" &&
    typeof candidate.degradedCount === "number" &&
    typeof candidate.blockedCount === "number" &&
    Array.isArray(candidate.items)
  );
}

function assertRecord(value: unknown, field: string) {
  if (!value || typeof value !== "object") {
    throw new Error(`invalid_${field}`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`invalid_${field}`);
  }
}

function assertExactString(value: unknown, expected: string, field: string) {
  if (value !== expected) {
    throw new Error(`invalid_${field}`);
  }
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`invalid_${field}`);
  }
}

function assertStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`invalid_${field}`);
  }
}

function assertActivityLogArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`invalid_${field}`);
  }
  value.forEach((entry, index) => {
    const record = assertRecord(entry, `${field}_${index}`);
    ["id", "createdAt", "title", "detail", "severity", "kind"].forEach((key) =>
      assertString(record[key], `${field}_${index}_${key}`)
    );
    assertOneOf(record.severity, ["info", "warning", "critical"], `${field}_${index}_severity`);
    assertOneOf(record.kind, ["activity", "incident"], `${field}_${index}_kind`);
  });
}

function assertIncidentPack(value: unknown, field: string) {
  const record = assertRecord(value, field);
  [
    "id",
    "name",
    "source",
    "severity",
    "createdAt",
    "summary",
    "recommendedAction",
    "mode",
    "policyPreset",
  ].forEach((key) => assertString(record[key], `${field}_${key}`));
  if (record.scenarioId !== null) {
    assertString(record.scenarioId, `${field}_scenarioId`);
  }
  assertBoolean(record.safeMode, `${field}_safeMode`);
  assertBoolean(record.panicMode, `${field}_panicMode`);
  assertStringArray(record.affectedTokens, `${field}_affectedTokens`);
  assertStringArray(record.affectedPairs, `${field}_affectedPairs`);
  assertStringArray(record.affectedVenues, `${field}_affectedVenues`);
  assertOneOf(record.source, ["manual", "demo", "live-session"], `${field}_source`);
  assertOneOf(record.severity, ["watch", "elevated", "critical"], `${field}_severity`);
  assertOneOf(record.mode, ["live", "demo"], `${field}_mode`);
  assertOneOf(record.policyPreset, ["retail", "treasury"], `${field}_policyPreset`);
}

function assertDecisionReport(value: unknown, field: string) {
  const record = assertRecord(value, field);
  [
    "headline",
    "posture",
    "executionRecommendation",
    "routeSummary",
    "orderSummary",
  ].forEach((key) => assertString(record[key], `${field}_${key}`));
  assertStringArray(record.nextActions, `${field}_nextActions`);
  assertReasonArray(record.reasons, `${field}_reasons`);
  assertOneOf(record.posture, ["clear", "caution", "degraded", "blocked"], `${field}_posture`);
  assertOneOf(
    record.executionRecommendation,
    ["allow-best-route", "prefer-safe-route", "block-execution"],
    `${field}_executionRecommendation`
  );
}

function assertPanicActionPlan(value: unknown, field: string) {
  const record = assertRecord(value, field);
  assertString(record.severity, `${field}_severity`);
  assertString(record.summary, `${field}_summary`);
  assertStringArray(record.candidateOrderKeys, `${field}_candidateOrderKeys`);
  assertBoolean(record.blockedRoute, `${field}_blockedRoute`);
  assertStringArray(record.nextSteps, `${field}_nextSteps`);
  assertOneOf(record.severity, ["watch", "elevated", "critical"], `${field}_severity`);
}

function assertReasonArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`invalid_${field}`);
  }
  value.forEach((reason, index) => {
    const record = assertRecord(reason, `${field}_${index}`);
    ["id", "subject", "title", "detail", "severity", "scope"].forEach((key) =>
      assertString(record[key], `${field}_${index}_${key}`)
    );
    assertBoolean(record.blocking, `${field}_${index}_blocking`);
    assertOneOf(record.severity, ["low", "medium", "high"], `${field}_${index}_severity`);
    assertOneOf(
      record.scope,
      ["route", "hop", "token", "venue", "order"],
      `${field}_${index}_scope`
    );
  });
}

function assertComparison(value: unknown, field: string) {
  if (value === null) return;
  const record = assertRecord(value, field);
  assertOneOf(record.executionTarget, ["base", "safe", "none"], `${field}_executionTarget`);
  assertBoolean(record.safeMode, `${field}_safeMode`);
}

function assertOneOf(value: unknown, allowed: string[], field: string) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`invalid_${field}`);
  }
}
