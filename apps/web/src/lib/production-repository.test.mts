import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresDocumentRepository,
  resolveProductionExtractionStatus,
} from "./production-repository.ts";
import {
  buildAcceptedTopicEnrichmentSnapshot,
  topicEnrichmentSnapshotFingerprint,
} from "./topic-enrichment-diff.ts";

test("existing extracted pages complete a legacy record without an extraction job", () => {
  assert.equal(resolveProductionExtractionStatus({ pageCount: 3, status: undefined }), "completed");
  assert.equal(resolveProductionExtractionStatus({ pageCount: 0, status: undefined }), "queued");
  assert.equal(resolveProductionExtractionStatus({ pageCount: 3, status: "running" }), "running");
});

test("production topic content edit rejects cross-workspace topics", async () => {
  const repository = createPostgresDocumentRepository({
    topicRecord: {
      findFirst: async () => null,
      update: async () => {
        throw new Error("update_should_not_run");
      },
    },
  });

  await assert.rejects(
    () =>
      repository.updateTopicContent({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        editedBy: "usr_1",
        summary: "Edited summary",
        title: "Edited title",
        topicId: "topic_other_workspace",
      }),
    /topic_not_found/,
  );
});

test("production updateTopicExportedFilePath persists the real exported filename", async () => {
  const updateCalls: unknown[] = [];
  const repository = createPostgresDocumentRepository({
    topicRecord: {
      findFirst: async () => ({ id: "topic_1" }),
      update: async (input: unknown) => {
        updateCalls.push(input);
        return { id: "topic_1" };
      },
    },
  });

  await repository.updateTopicExportedFilePath({
    context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
    exportedFilePath: "29-air-ground-position-95ac0bd3c2.md",
    topicId: "topic_1",
  });

  assert.deepEqual(updateCalls, [
    {
      data: { exportedFilePath: "29-air-ground-position-95ac0bd3c2.md" },
      where: { id: "topic_1" },
    },
  ]);
});

test("production document reads exclude soft-deleted documents", async () => {
  const findManyCalls: unknown[] = [];
  const findFirstCalls: unknown[] = [];
  const repository = createPostgresDocumentRepository({
    document: {
      findFirst: async (input: unknown) => {
        findFirstCalls.push(input);
        return null;
      },
      findMany: async (input: unknown) => {
        findManyCalls.push(input);
        return [];
      },
    },
  });

  await assert.rejects(
    () =>
      repository.getDocumentById({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        documentId: "doc_deleted",
      }),
    /document_not_found/,
  );
  await repository.getDocuments({
    role: "admin",
    userId: "usr_1",
    workspaceId: "wrk_1",
  });
  await repository.getDocumentMetrics({
    role: "admin",
    userId: "usr_1",
    workspaceId: "wrk_1",
  });

  assert.equal(
    findFirstCalls.some((call) =>
      JSON.stringify(call).includes('"deletedAt":null'),
    ),
    true,
  );
  assert.equal(
    findManyCalls.every((call) =>
      JSON.stringify(call).includes('"deletedAt":null'),
    ),
    true,
  );
});

test("topic enrichment resolution rejects cross-workspace topics", async () => {
  const repository = createPostgresDocumentRepository({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        topicRecord: { findFirst: async () => null },
      }),
  });
  await assert.rejects(
    () => repository.resolveTopicEnrichmentCandidate({
      auditId: "audit_1",
      context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
      decision: "accept",
      resolvedBy: "usr_1",
      topicId: "topic_other_workspace",
    }),
    /topic_not_found/,
  );
});

test("only one concurrent topic enrichment resolution can claim a candidate", async () => {
  const accepted = {
    enrichedBody: "Old body",
    enrichedSummary: "Old summary",
    enrichedTitle: "Old title",
    proposedSourcePageNumbers: [],
    reviewStatus: "needs_review",
    summary: "Raw summary",
    title: "Raw title",
  };
  const repository = createPostgresDocumentRepository({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        topicEnrichmentAudit: {
          findFirst: async () => ({
            baselineFingerprint: topicEnrichmentSnapshotFingerprint(
              buildAcceptedTopicEnrichmentSnapshot(accepted),
            ),
            candidateBody: "New body",
            candidateProposedSourcePageNumbers: [],
            candidateSummary: "New summary",
            candidateTitle: "New title",
            id: "audit_1",
          }),
          updateMany: async () => ({ count: 0 }),
        },
        topicRecord: {
          findFirst: async () => accepted,
        },
      }),
  });
  await assert.rejects(
    () => repository.resolveTopicEnrichmentCandidate({
      auditId: "audit_1",
      context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
      decision: "accept",
      resolvedBy: "usr_1",
      topicId: "topic_1",
    }),
    /topic_enrichment_candidate_not_pending/,
  );
});
