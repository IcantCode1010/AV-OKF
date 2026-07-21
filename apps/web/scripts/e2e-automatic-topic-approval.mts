import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { AuthWorkspaceContext } from "../src/lib/auth-workspace.ts";
import type { BulkTopicApprovalJobPayload } from "../src/lib/bulk-topic-approval-queue.ts";
import {
  createAutomaticBulkApprovalRun,
  runBulkTopicApprovalJob,
} from "../src/lib/bulk-topic-approval.ts";
import {
  activateKnowledgeProfileVersion,
  createKnowledgeBundle,
  createKnowledgeProfileDraft,
  resolveKnowledgeBundleRoot,
} from "../src/lib/knowledge-bundles.ts";
import { getKnowledgeProfileTemplate } from "../src/lib/knowledge-profile.ts";
import { getPrisma } from "../src/lib/prisma.ts";

process.env.AV_OKF_BACKEND = "production";

const db = getPrisma();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const workspaceId = `e2e-auto-workspace-${suffix}`;
const userId = `e2e-auto-user-${suffix}`;
const context: AuthWorkspaceContext = { role: "admin", userId, workspaceId };
let workspaceRoot: string | null = null;

async function waitForEmbeddingJob(bundleId: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const job = await db.okfConceptEmbeddingJob.findFirst({
      orderBy: { queuedAt: "desc" },
      where: { knowledgeBundleId: bundleId },
    });
    if (job && ["completed", "failed"].includes(job.status)) return job.status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("automatic_approval_embedding_job_timeout");
}

try {
  await db.workspace.create({ data: { id: workspaceId, name: "Automatic Approval E2E" } });

  const automatedBundle = await createKnowledgeBundle({
    context,
    description: "Disposable automated approval verification bundle.",
    name: `Automated Approval ${suffix}`,
    templateId: "generic",
  });
  const manualBundle = await createKnowledgeBundle({
    context,
    description: "Disposable manual review control bundle.",
    name: `Manual Review ${suffix}`,
    templateId: "generic",
  });
  workspaceRoot = path.resolve(
    resolveKnowledgeBundleRoot({ bundleId: automatedBundle.id, workspaceId }),
    "../..",
  );

  const automatedProfile = getKnowledgeProfileTemplate("generic");
  automatedProfile.automation.autoApproveEnrichedTopics = true;
  const profileVersion = await createKnowledgeProfileDraft({
    bundleId: automatedBundle.id,
    context,
    profile: automatedProfile,
  });
  await activateKnowledgeProfileVersion({
    bundleId: automatedBundle.id,
    context,
    version: profileVersion,
  });

  const document = await db.document.create({
    data: {
      description: "Disposable source for automatic approval verification.",
      fileType: "PDF",
      knowledgeBundleId: automatedBundle.id,
      mimeType: "application/pdf",
      owner: "E2E",
      pages: 3,
      size: "1 KB",
      sizeBytes: 1024,
      sourceType: "Uploaded PDF",
      status: "ready",
      tags: ["e2e", "automation"],
      title: "Automatic Approval Verification Manual",
      updatedLabel: "Just now",
      workspaceId,
    },
  });
  const topic = await db.topicRecord.create({
    data: {
      confidence: "high",
      documentId: document.id,
      enrichedBody: "Verify the equipment condition before operation and record any discrepancy.",
      enrichedSummary: "A reviewed-ready pre-operation verification procedure.",
      enrichedTitle: "Pre-Operation Verification",
      enrichmentStatus: "completed",
      knowledgeBundleId: automatedBundle.id,
      okfMetadata: { type: "procedure" },
      originalSummary: "Verify equipment condition.",
      originalTitle: "Equipment verification",
      pageEnd: 2,
      pageStart: 2,
      reviewStatus: "needs_review",
      sourcePageNumbers: [2],
      summary: "Verify equipment condition.",
      title: "Equipment verification",
      topicType: "procedure",
      workspaceId,
    },
  });
  const authoringRun = await db.knowledgeAuthoringRun.create({
    data: {
      automaticTopicApprovalEnabled: true,
      completedStages: ["metadata_discovery", "topic_discovery", "topic_enrichment", "validation"],
      currentStage: "ready_for_review",
      documentId: document.id,
      knowledgeBundleId: automatedBundle.id,
      profileVersion,
      readyAt: new Date(),
      requestedBy: userId,
      status: "ready_for_review",
      workspaceId,
    },
  });

  let queuedPayload: BulkTopicApprovalJobPayload | null = null;
  const run = await createAutomaticBulkApprovalRun({
    authoringRunId: authoringRun.id,
    enqueue: async (payload) => { queuedPayload = payload; },
  });
  assert(run, "automation-enabled authoring run should create a bulk run");
  assert.equal(run.mode, "automated");
  assert(queuedPayload, "eligible automatic run should enqueue worker payload");

  await runBulkTopicApprovalJob(queuedPayload);

  const [completedRun, approvedTopic] = await Promise.all([
    db.bulkTopicApprovalRun.findUniqueOrThrow({
      include: { items: true },
      where: { id: run.id },
    }),
    db.topicRecord.findUniqueOrThrow({ where: { id: topic.id } }),
  ]);
  assert.equal(completedRun.status, "completed");
  assert.equal(completedRun.items.length, 1);
  assert.equal(completedRun.items[0]?.status, "succeeded");
  assert.equal(approvedTopic.reviewStatus, "approved");
  assert.equal(approvedTopic.approvalMode, "automated");
  assert.equal(approvedTopic.approvedBy, userId);
  assert(approvedTopic.approvedAt);
  assert(approvedTopic.exportedFilePath);

  const exportedPath = path.join(
    resolveKnowledgeBundleRoot({ bundleId: automatedBundle.id, workspaceId }),
    approvedTopic.exportedFilePath,
  );
  const exported = await readFile(exportedPath, "utf8");
  assert.match(exported, /review_status: ["']approved["']/);
  assert.match(exported, new RegExp(`approved_by: ["']?automation:${userId}`));
  assert.match(exported, /approved_at: ["']\d{4}-\d{2}-\d{2}["']/);
  const embeddingJobStatus = await waitForEmbeddingJob(automatedBundle.id);

  const duplicate = await createAutomaticBulkApprovalRun({
    authoringRunId: authoringRun.id,
    enqueue: async () => { throw new Error("idempotent run must not enqueue twice"); },
  });
  assert.equal(duplicate?.id, run.id);
  assert.equal(
    await db.bulkTopicApprovalRun.count({ where: { authoringRunId: authoringRun.id } }),
    1,
  );

  const manualDocument = await db.document.create({
    data: {
      fileType: "PDF",
      knowledgeBundleId: manualBundle.id,
      mimeType: "application/pdf",
      owner: "E2E",
      size: "1 KB",
      sizeBytes: 1024,
      sourceType: "Uploaded PDF",
      status: "ready",
      tags: [],
      title: "Manual Bundle Control",
      updatedLabel: "Just now",
      workspaceId,
    },
  });
  const manualRun = await db.knowledgeAuthoringRun.create({
    data: {
      automaticTopicApprovalEnabled: false,
      documentId: manualDocument.id,
      knowledgeBundleId: manualBundle.id,
      profileVersion: 1,
      requestedBy: userId,
      status: "ready_for_review",
      workspaceId,
    },
  });
  const unaffected = await createAutomaticBulkApprovalRun({
    authoringRunId: manualRun.id,
    enqueue: async () => { throw new Error("disabled bundle must not enqueue"); },
  });
  assert.equal(unaffected, null);

  console.log(JSON.stringify({
    automatedBundleIsolated: true,
    exportedFilePath: approvedTopic.exportedFilePath,
    embeddingJobStatus,
    idempotentRunId: run.id,
    itemStatus: completedRun.items[0]?.status,
    manualBundleUnaffected: true,
    runStatus: completedRun.status,
  }, null, 2));
} finally {
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  if (workspaceRoot) await rm(workspaceRoot, { force: true, recursive: true });
  await db.$disconnect();
}

// The exporter owns a process-scoped BullMQ connection in production. The
// disposable verification process can exit after its database and file cleanup.
process.exit(0);
