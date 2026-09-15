import assert from "node:assert/strict";
import test from "node:test";

import { buildBundleWorkflowSnapshot, type BundleWorkflowFacts } from "./bundle-workflow.ts";

const emptyFacts: BundleWorkflowFacts = {
  approvedTopicCount: 0,
  assistantAnswerCount: 0,
  bulkApprovalActive: 0,
  bulkApprovalFailed: 0,
  documentCount: 0,
  entityCount: 0,
  entityJobsActive: 0,
  entityJobsCompleted: 0,
  entityJobsFailed: 0,
  entityJobsTotal: 0,
  exportedTopicCount: 0,
  expansionActive: 0,
  expansionCompleted: 0,
  expansionFailed: 0,
  expansionRunCount: 0,
  needsReviewTopicCount: 0,
  processingActive: 0,
  processingFailed: 0,
  processedDocumentCount: 0,
  publishedRelationCount: 0,
  relationReviewReady: 0,
  relationVerificationActive: 0,
  relationVerificationFailed: 0,
  topicCount: 0,
};

test("empty bundles direct the reviewer to add documents", () => {
  const snapshot = buildBundleWorkflowSnapshot({ bundleId: "bundle one", facts: emptyFacts });
  assert.equal(snapshot.stages[0]?.status, "action_required");
  assert.equal(snapshot.nextAction?.label, "Add documents");
  assert.equal(snapshot.nextAction?.href, "/documents?scope=bundle&knowledgeBundleId=bundle%20one");
});

test("review-ready topics become the next action after processing", () => {
  const snapshot = buildBundleWorkflowSnapshot({
    bundleId: "bundle-a",
    facts: { ...emptyFacts, documentCount: 1, needsReviewTopicCount: 12, processedDocumentCount: 1, topicCount: 12 },
  });
  assert.equal(snapshot.stages.find((stage) => stage.id === "publication")?.status, "action_required");
  assert.equal(snapshot.nextAction?.label, "Review topics");
});

test("publication warnings direct the reviewer back to Review", () => {
  const snapshot = buildBundleWorkflowSnapshot({
    bundleId: "bundle-a",
    facts: {
      ...emptyFacts,
      approvedTopicCount: 3,
      documentCount: 1,
      exportedTopicCount: 2,
      processedDocumentCount: 1,
      topicCount: 3,
    },
  });

  assert.equal(snapshot.stages.find((stage) => stage.id === "publication")?.status, "completed_with_warnings");
  assert.equal(snapshot.nextAction?.label, "Resolve publication warnings");
  assert.equal(snapshot.nextAction?.href, "/knowledge/bundle-a/review");
  assert.match(snapshot.nextAction?.detail ?? "", /1 approved topic has not been exported/);
});

test("published topics with entities direct the reviewer to connection expansion", () => {
  const snapshot = buildBundleWorkflowSnapshot({
    bundleId: "bundle-a",
    facts: {
      ...emptyFacts,
      approvedTopicCount: 4,
      documentCount: 1,
      entityCount: 8,
      entityJobsCompleted: 4,
      entityJobsTotal: 4,
      exportedTopicCount: 4,
      processedDocumentCount: 1,
      topicCount: 4,
    },
  });
  assert.equal(snapshot.stages.find((stage) => stage.id === "connections")?.status, "action_required");
  assert.equal(snapshot.nextAction?.label, "Run connection expansion");
});

test("verified connections take precedence over chat testing", () => {
  const snapshot = buildBundleWorkflowSnapshot({
    bundleId: "bundle-a",
    facts: {
      ...emptyFacts,
      approvedTopicCount: 4,
      documentCount: 1,
      entityCount: 8,
      entityJobsCompleted: 4,
      entityJobsTotal: 4,
      expansionCompleted: 1,
      expansionRunCount: 1,
      exportedTopicCount: 4,
      processedDocumentCount: 1,
      relationReviewReady: 3,
      topicCount: 4,
    },
  });
  assert.equal(snapshot.nextAction?.label, "Review connections");
  assert.equal(snapshot.active, false);
});

test("running work enables live workflow polling", () => {
  const snapshot = buildBundleWorkflowSnapshot({
    bundleId: "bundle-a",
    facts: { ...emptyFacts, documentCount: 1, processingActive: 1 },
  });
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.stages.find((stage) => stage.id === "processing")?.status, "running");
});
