import { presentEfbClassification } from "./efb-classification-presentation.ts";

export type EfbMetricRow = {
  status: string;
  result: unknown;
};

export function summarizeEfbMetadata(rows: EfbMetricRow[]) {
  const summary = {
    total: rows.length,
    ready: 0,
    classifying: 0,
    needsReview: 0,
    blocked: 0,
    failed: 0,
    deterministic: 0,
    modelClassified: 0,
    repairsAttempted: 0,
    repairsSucceeded: 0,
    discardedEvidence: 0,
    issues: {} as Record<string, number>,
    states: {} as Record<string, number>,
  };
  for (const row of rows) {
    const result = row.result as {
      provider?: string;
      issues?: string[];
      discardedEvidence?: unknown[];
      evidenceRepair?: { attempted?: boolean; succeeded?: boolean };
    };
    if (row.status === "ready") summary.ready++;
    else if (["queued", "running"].includes(row.status)) summary.classifying++;
    else if (row.status === "needs_review") summary.needsReview++;
    else if (row.status === "blocked") summary.blocked++;
    else if (["failed", "cancelled"].includes(row.status)) summary.failed++;
    if (result.provider === "deterministic") summary.deterministic++;
    else if (result.provider) summary.modelClassified++;
    if (result.evidenceRepair?.attempted) summary.repairsAttempted++;
    if (result.evidenceRepair?.succeeded) summary.repairsSucceeded++;
    summary.discardedEvidence += result.discardedEvidence?.length ?? 0;
    for (const issue of result.issues ?? []) summary.issues[issue] = (summary.issues[issue] ?? 0) + 1;
    const state = presentEfbClassification(row.status, result.issues).label;
    summary.states[state] = (summary.states[state] ?? 0) + 1;
  }
  return summary;
}
