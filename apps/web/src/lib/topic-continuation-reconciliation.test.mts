import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTopicContinuationReconciliation,
  type ReconciliationTopic,
} from "./topic-continuation-reconciliation.ts";
import { buildTopicContinuationReconciliationJobId } from "./topic-continuation-reconciliation-queue.ts";
import { TOPIC_CONTINUATION_RESOLVER_VERSION } from "./topic-discovery.ts";

const page = (pageNumber: number, text: string) => ({
  charCount: text.length,
  imageCount: 0,
  pageNumber,
  tables: [],
  text,
});

test("reconciliation promotes an enriched proposed continuation without invalidating enrichment", () => {
  const updates = buildTopicContinuationReconciliation({
    pages: [
      page(131, "Smoke, Fire or Fumes\nContinued on next page"),
      page(132, "Smoke, Fire or Fumes continued\nSteps 23-25"),
    ],
    topics: [topic({
      evidenceHeadings: ["Smoke, Fire or Fumes"],
      pageNumbers: [131],
      proposedSourcePageNumbers: [132],
      title: "Smoke, Fire or Fumes Response Procedure",
    })],
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.sourcePageNumbers, [131, 132]);
  assert.deepEqual(updates[0]!.proposedSourcePageNumbers, []);
  assert.equal(updates[0]!.enrichmentStatus, "completed");
  assert.equal(updates[0]!.invalidatedEnrichment, false);
  assert.equal(
    updates[0]!.discoveryMetadata.continuationResolverVersion,
    TOPIC_CONTINUATION_RESOLVER_VERSION,
  );
});

test("reconciliation invalidates completed enrichment for a previously unseen page", () => {
  const updates = buildTopicContinuationReconciliation({
    pages: [
      page(10, "Returns Procedure\nContinued on next page"),
      page(11, "Returns Procedure continued\nMore steps"),
    ],
    topics: [topic({
      evidenceHeadings: ["Returns Procedure"],
      pageNumbers: [10],
      proposedSourcePageNumbers: [],
      title: "Returns Procedure",
    })],
  });
  assert.deepEqual(updates[0]!.sourcePageNumbers, [10, 11]);
  assert.equal(updates[0]!.enrichmentStatus, "none");
  assert.equal(updates[0]!.invalidatedEnrichment, true);
});

test("approved, rejected, and bulk-claimed topics are not reconciled", () => {
  const pages = [
    page(1, "Policy\nContinued on next page"),
    page(2, "Policy continued\nMore"),
  ];
  const updates = buildTopicContinuationReconciliation({
    pages,
    topics: [
      topic({ id: "approved", reviewStatus: "approved" }),
      topic({ id: "rejected", reviewStatus: "rejected" }),
      topic({ bulkApprovalRunId: "run-1", id: "claimed" }),
    ],
  });
  assert.deepEqual(updates, []);
});

test("reconciliation is idempotent after the resolver version is stamped", () => {
  const updates = buildTopicContinuationReconciliation({
    pages: [page(1, "Policy"), page(2, "Other")],
    topics: [topic({
      discoveryMetadata: { continuationResolverVersion: TOPIC_CONTINUATION_RESOLVER_VERSION },
    })],
  });
  assert.deepEqual(updates, []);
});

test("reconciliation job IDs are deterministic and document-scoped", () => {
  const payload = { documentId: "doc_123", workspaceId: "workspace_123" };
  assert.equal(
    buildTopicContinuationReconciliationJobId(payload),
    buildTopicContinuationReconciliationJobId(payload),
  );
  assert.notEqual(
    buildTopicContinuationReconciliationJobId(payload),
    buildTopicContinuationReconciliationJobId({ ...payload, documentId: "doc_456" }),
  );
});

function topic(overrides: Partial<ReconciliationTopic> = {}): ReconciliationTopic {
  return {
    bulkApprovalRunId: null,
    confidence: "high",
    discoveryMetadata: {},
    enrichmentStatus: "completed",
    evidenceHeadings: ["Policy"],
    id: "topic-1",
    pageNumbers: [1],
    proposedSourcePageNumbers: [2],
    rationale: "section",
    reviewStatus: "needs_review",
    summary: "Summary.",
    title: "Policy",
    topicType: "policy",
    ...overrides,
  };
}
