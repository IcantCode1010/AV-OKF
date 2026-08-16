import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticTopicBlockers,
  automaticTopicEligibilityErrors,
  bulkTopicSelectionFingerprint,
  buildTopicEnrichmentAssessment,
  bulkApprovalSourcePageNumbers,
  buildBulkTopicApprovalStatusSnapshot,
  claimBulkTopicForRun,
  createOrReuseBulkPreflight,
  findPageOverlapErrors,
  isBulkTopicApprovalRunConfirmable,
  shouldBlockBulkPageOverlap,
  summarizeBulkTopicApprovalProgress,
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

test("bulk selection fingerprint ignores click order and duplicate ids", () => {
  const first = bulkTopicSelectionFingerprint({
    bundleId: "bundle-1",
    topicIds: ["topic-b", "topic-a", "topic-a"],
    workspaceId: "workspace-1",
  });
  const reordered = bulkTopicSelectionFingerprint({
    bundleId: "bundle-1",
    topicIds: ["topic-a", "topic-b"],
    workspaceId: "workspace-1",
  });
  const otherBundle = bulkTopicSelectionFingerprint({
    bundleId: "bundle-2",
    topicIds: ["topic-a", "topic-b"],
    workspaceId: "workspace-1",
  });

  assert.equal(first, reordered);
  assert.notEqual(first, otherBundle);
});

test("repeated and concurrent preflight requests reuse one run", async () => {
  let stored: { id: string } | null = null;
  let createCalls = 0;
  const prepare = () => createOrReuseBulkPreflight({
    create: async () => {
      createCalls += 1;
      await Promise.resolve();
      if (stored) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      stored = { id: "run-1" };
      return stored;
    },
    findExisting: async () => stored,
  });

  const [first, second] = await Promise.all([prepare(), prepare()]);
  const repeated = await prepare();

  assert.equal(first.id, "run-1");
  assert.equal(second.id, "run-1");
  assert.equal(repeated.id, "run-1");
  assert.equal(createCalls, 2);
});

test("bulk run status fingerprints are deterministic and track item progress", () => {
  const firstItem = makeBulkStatusItem("item-a", "approving");
  const secondItem = makeBulkStatusItem("item-b", "pending");
  const running = buildBulkTopicApprovalStatusSnapshot({
    errorCode: null,
    errorMessage: null,
    id: "run-1",
    items: [firstItem, secondItem],
    status: "running",
  });
  const reversed = buildBulkTopicApprovalStatusSnapshot({
    errorCode: null,
    errorMessage: null,
    id: "run-1",
    items: [secondItem, firstItem],
    status: "running",
  });
  const completed = buildBulkTopicApprovalStatusSnapshot({
    errorCode: null,
    errorMessage: null,
    id: "run-1",
    items: [
      { ...firstItem, exportedFilePath: "concepts/topic.md", status: "succeeded" },
      secondItem,
    ],
    status: "completed_with_failures",
  });

  assert.equal(running.active, true);
  assert.equal(running.fingerprint, reversed.fingerprint);
  assert.equal(completed.active, false);
  assert.notEqual(running.fingerprint, completed.fingerprint);
});

test("bulk progress reports the active topic and real terminal counts", () => {
  const progress = summarizeBulkTopicApprovalProgress([
    { status: "succeeded", topic: { enrichedTitle: "Exported topic", title: "Original exported" } },
    { status: "exporting", topic: { enrichedTitle: "Current topic", title: "Original current" } },
    { status: "pending", topic: { enrichedTitle: null, title: "Waiting topic" } },
    { status: "failed", topic: { enrichedTitle: "Failed topic", title: "Original failed" } },
  ]);

  assert.deepEqual(progress, {
    activeTitle: "Current topic",
    completed: 2,
    failed: 1,
    inProgress: 1,
    pending: 1,
    succeeded: 1,
    total: 4,
  });
});

test("stale prepared confirmations cannot be presented as actionable", () => {
  const currentTopic = makeTopic({ reviewStatus: "needs_review" });
  const revisionFingerprint = topicRevisionFingerprint(currentTopic);

  assert.equal(isBulkTopicApprovalRunConfirmable({
    items: [{ revisionFingerprint, topic: currentTopic }],
  }), true);
  assert.equal(isBulkTopicApprovalRunConfirmable({
    items: [{
      revisionFingerprint,
      topic: { ...currentTopic, reviewStatus: "approved" },
    }],
  }), false);
});

function makeBulkStatusItem(id: string, status: string) {
  return {
    exportedFilePath: null,
    failureCode: null,
    failureMessage: null,
    id,
    retryCount: 0,
    status,
  };
}

test("page overlap diagnostics detect a selected topic sharing approved provenance", () => {
  assert.deepEqual(
    findPageOverlapErrors(
      [{ documentId: "doc-a", id: "selected", sourcePageNumbers: [10, 11] }],
      [{ documentId: "doc-a", id: "approved", sourcePageNumbers: [11, 12] }],
    ),
    ["bulk_topic_overlaps_approved:selected:approved"],
  );
});

test("page overlap warns manual review but blocks unattended automation", () => {
  assert.equal(shouldBlockBulkPageOverlap("manual"), false);
  assert.equal(shouldBlockBulkPageOverlap("automated"), true);
});

test("completed enriched topics remain eligible when additional context pages were used", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  const topic = makeTopic();
  assert.deepEqual(topicEligibilityErrors(topic, profile, { title: "Manual" }), []);
  assert.deepEqual(
    topicEligibilityErrors({ ...topic, enrichmentStatus: "failed", proposedSourcePageNumbers: [8] }, profile, { title: "Manual" }),
    ["topic_enrichment_not_completed"],
  );
  assert.deepEqual(
    topicEligibilityErrors({ ...topic, proposedSourcePageNumbers: [3, 4] }, profile, { title: "Manual" }),
    [],
  );
});

test("bulk approval promotes disclosed context pages and scores enrichment completeness", () => {
  const topic = { ...makeTopic(), proposedSourcePageNumbers: [2, 3, 4] };
  assert.deepEqual(bulkApprovalSourcePageNumbers(topic), [1, 2, 3, 4]);
  assert.deepEqual(buildTopicEnrichmentAssessment(topic), { level: "complete", score: 100 });
  assert.deepEqual(
    buildTopicEnrichmentAssessment({ ...topic, enrichedBody: null, enrichmentStatus: "failed" }),
    { level: "partial", score: 60 },
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

function makeTopic(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}
