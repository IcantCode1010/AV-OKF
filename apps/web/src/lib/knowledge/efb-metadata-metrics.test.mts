import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeEfbMetadata } from "./efb-metadata-metrics.ts";

test("summarizes model, repair, evidence and field-specific states", () => {
  const summary = summarizeEfbMetadata([
    { status: "ready", result: { provider: "openai", issues: [], evidenceRepair: { attempted: true, succeeded: true }, discardedEvidence: [{}] } },
    { status: "needs_review", result: { provider: "deterministic", issues: ["pilot_qrh_target_id_missing_ambiguous_or_outside_document_scope"] } },
    { status: "running", result: {} },
  ]);
  assert.equal(summary.ready, 1);
  assert.equal(summary.classifying, 1);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.modelClassified, 1);
  assert.equal(summary.deterministic, 1);
  assert.equal(summary.repairsSucceeded, 1);
  assert.equal(summary.states["Choose QRH category"], 1);
});
