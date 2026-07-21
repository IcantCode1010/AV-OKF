import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticTopicBlockers,
  automaticTopicEligibilityErrors,
  claimBulkTopicForRun,
  findPageOverlapErrors,
  topicEligibilityErrors,
  topicRevisionFingerprint,
  shouldApproveBulkTopic,
} from "./bulk-topic-approval.ts";
import { getKnowledgeProfileTemplate } from "./knowledge-profile.ts";

test("page overlap is scoped to one source document", () => {
  const selected = [
    { documentId: "doc-a", id: "topic-a", sourcePageNumbers: [3, 4] },
    { documentId: "doc-b", id: "topic-b", sourcePageNumbers: [4, 5] },
  ];
  assert.deepEqual(findPageOverlapErrors(selected, []), []);
  assert.deepEqual(
    findPageOverlapErrors([...selected, { documentId: "doc-a", id: "topic-c", sourcePageNumbers: [4] }], []),
    ["bulk_topic_page_overlap:topic-a:topic-c"],
  );
});

test("page overlap against a prior approval blocks the selected topic", () => {
  assert.deepEqual(
    findPageOverlapErrors(
      [{ documentId: "doc-a", id: "selected", sourcePageNumbers: [10, 11] }],
      [{ documentId: "doc-a", id: "approved", sourcePageNumbers: [11, 12] }],
    ),
    ["bulk_topic_overlaps_approved:selected:approved"],
  );
});

test("only completed enriched and unresolved-page-free topics are eligible", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  const topic = makeTopic();
  assert.deepEqual(topicEligibilityErrors(topic, profile, { title: "Manual" }), []);
  assert.deepEqual(
    topicEligibilityErrors({ ...topic, enrichmentStatus: "failed", proposedSourcePageNumbers: [8] }, profile, { title: "Manual" }),
    ["topic_enrichment_not_completed", "topic_proposed_pages_require_review"],
  );
});

test("automatic approval accepts high confidence only", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  const topic = makeTopic();
  assert.deepEqual(
    automaticTopicEligibilityErrors(topic, profile, { title: "Manual" }),
    [],
  );
  assert.deepEqual(
    automaticTopicEligibilityErrors(
      { ...topic, confidence: "medium" },
      profile,
      { title: "Manual" },
    ),
    ["automatic_topic_requires_high_confidence"],
  );
});

test("automatic overlap blocks both candidates but not matching pages in different documents", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  const first = { ...makeTopic(), document: { title: "Manual A" } };
  const second = {
    ...makeTopic(),
    document: { title: "Manual A" },
    id: "topic-2",
    sourcePageNumbers: [2, 3],
  };
  const blockers = automaticTopicBlockers([first, second], [], profile);
  assert.match(blockers.get(first.id)?.[0] ?? "", /bulk_topic_page_overlap/);
  assert.match(blockers.get(second.id)?.[0] ?? "", /bulk_topic_page_overlap/);

  const otherDocument = { ...second, documentId: "doc-2", document: { title: "Manual B" } };
  const isolated = automaticTopicBlockers([first, otherDocument], [], profile);
  assert.deepEqual(isolated.get(first.id), []);
  assert.deepEqual(isolated.get(otherDocument.id), []);
});

test("topic revision fingerprint changes with reviewed enrichment content", () => {
  const topic = makeTopic();
  assert.notEqual(
    topicRevisionFingerprint(topic),
    topicRevisionFingerprint({ ...topic, enrichedSummary: "Changed summary" }),
  );
});

test("two concurrent runs can process a topic only once", async () => {
  let claimedBy: string | null = null;
  let exports = 0;
  let indexEntries = 0;
  let logEntries = 0;
  const updateMany = async (args: { data: { bulkApprovalRunId: string } }) => {
    await Promise.resolve();
    if (claimedBy !== null) return { count: 0 };
    claimedBy = args.data.bulkApprovalRunId;
    return { count: 1 };
  };
  async function process(runId: string) {
    await claimBulkTopicForRun({ runId, topicId: "topic-1", updateMany, workspaceId: "ws-1" });
    exports += 1;
    indexEntries += 1;
    logEntries += 1;
    return "succeeded";
  }
  const results = await Promise.allSettled([process("run-a"), process("run-b")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.status, "rejected");
  if (rejected?.status === "rejected") {
    assert.match(String(rejected.reason), /bulk_topic_already_processed/);
  }
  assert.equal(exports, 1);
  assert.equal(indexEntries, 1);
  assert.equal(logEntries, 1);
});

test("an approval-complete retry resumes at export without approving again", () => {
  assert.equal(shouldApproveBulkTopic({ bulkApprovalRunId: "run-a", reviewStatus: "approved", runId: "run-a" }), false);
  assert.throws(
    () => shouldApproveBulkTopic({ bulkApprovalRunId: "run-a", reviewStatus: "approved", runId: "run-b" }),
    /bulk_topic_already_processed/,
  );
});

function makeTopic() {
  return {
    bulkApprovalRunId: null,
    confidence: "high",
    documentId: "doc-1",
    enrichedBody: "Detailed body",
    enrichedSummary: "Summary",
    enrichedTitle: "Title",
    enrichmentStatus: "completed",
    exportedFilePath: null,
    id: "topic-1",
    knowledgeBundleId: "bundle-1",
    okfMetadata: { type: "system_topic" },
    proposedSourcePageNumbers: [],
    reviewStatus: "needs_review",
    sourcePageNumbers: [1, 2],
    updatedAt: new Date("2026-07-20T12:00:00Z"),
    workspaceId: "ws-1",
  };
}
