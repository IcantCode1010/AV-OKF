import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthWorkspaceContext } from "../src/lib/auth-workspace.ts";
import {
  requestKnowledgeBundleDeletion,
  runKnowledgeBundleDeletionJob,
} from "../src/lib/knowledge-bundle-deletion.ts";
import { DELETED_KNOWLEDGE_SOURCE_CHAT_ANSWER } from "../src/lib/chat-evidence-tombstone.ts";
import {
  createKnowledgeBundle,
  resolveKnowledgeBundleRoot,
} from "../src/lib/knowledge-bundles.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import {
  buildDocumentObjectKey,
  getObjectStorage,
} from "../src/lib/production-storage.ts";

process.env.AV_OKF_BACKEND = "production";

const db = getPrisma();
const storage = getObjectStorage();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const workspaceId = `e2e-bundle-delete-workspace-${suffix}`;
const adminId = `e2e-bundle-delete-admin-${suffix}`;
const memberId = `e2e-bundle-delete-member-${suffix}`;
const adminContext: AuthWorkspaceContext = { role: "admin", userId: adminId, workspaceId };
let workspaceRoot: string | null = null;
let objectKey: string | null = null;

try {
  await db.user.createMany({
    data: [
      { email: `${adminId}@example.invalid`, id: adminId },
      { email: `${memberId}@example.invalid`, id: memberId },
    ],
  });
  await db.workspace.create({ data: { id: workspaceId, name: "Bundle Deletion E2E" } });
  await db.workspaceMember.createMany({
    data: [
      { role: "admin", userId: adminId, workspaceId },
      { role: "member", userId: memberId, workspaceId },
    ],
  });

  const deletedBundle = await createKnowledgeBundle({
    context: adminContext,
    description: "Disposable bundle whose source must survive.",
    name: `Deleted Bundle ${suffix}`,
    templateId: "generic",
  });
  const survivingBundle = await createKnowledgeBundle({
    context: adminContext,
    description: "Destination for reassignment.",
    name: `Surviving Bundle ${suffix}`,
    templateId: "generic",
  });
  const deletedBundleRoot = resolveKnowledgeBundleRoot({
    bundleId: deletedBundle.id,
    workspaceId,
  });
  workspaceRoot = path.resolve(deletedBundleRoot, "../..");

  const document = await db.document.create({
    data: {
      description: "Source content retained after bundle deletion.",
      fileType: "PDF",
      knowledgeBundleId: deletedBundle.id,
      mimeType: "application/pdf",
      originalFilename: "bundle-source-preservation.pdf",
      owner: "E2E",
      pages: 1,
      ragStatus: "ready",
      size: "1 KB",
      sizeBytes: 1024,
      sourceType: "Uploaded PDF",
      status: "ready",
      tags: ["e2e", "bundle-deletion"],
      title: `Preserved Source ${suffix}`,
      updatedLabel: "Just now",
      workspaceId,
    },
  });
  objectKey = buildDocumentObjectKey({ documentId: document.id, workspaceId });
  const pdfBytes = Buffer.from("%PDF-1.4\n% bundle source preservation fixture\n%%EOF\n");
  await storage.putObject({ body: pdfBytes, contentType: "application/pdf", key: objectKey });
  await db.documentObject.create({
    data: {
      bucket: process.env.S3_BUCKET ?? "av-okf",
      contentType: "application/pdf",
      documentId: document.id,
      kind: "original_pdf",
      objectKey,
      sizeBytes: pdfBytes.length,
      workspaceId,
    },
  });
  await db.documentCustomProperty.create({
    data: { documentId: document.id, key: "preserved", value: "true" },
  });
  const extractionJob = await db.extractionJob.create({
    data: { completedAt: new Date(), documentId: document.id, status: "completed", workspaceId },
  });
  await db.extractedPage.create({
    data: {
      charCount: 41,
      documentId: document.id,
      imageCount: 0,
      pageNumber: 1,
      tables: [],
      text: "This extracted source must remain available.",
      workspaceId,
    },
  });
  await db.extractionLog.create({
    data: {
      documentId: document.id,
      jobId: extractionJob.id,
      level: "info",
      message: "Source extraction completed",
      workspaceId,
    },
  });
  await db.activityEvent.create({
    data: {
      documentId: document.id,
      documentTitle: document.title,
      label: "Extraction preserved",
      status: "Complete",
      timestamp: new Date().toISOString(),
      workspaceId,
    },
  });

  const exportedFilePath = "concepts/procedure/disposable-bundle-concept.md";
  const topic = await db.topicRecord.create({
    data: {
      confidence: "high",
      documentId: document.id,
      enrichmentStatus: "completed",
      enrichedBody: "Derived knowledge that must be removed.",
      enrichedSummary: "Disposable bundle concept.",
      enrichedTitle: "Disposable Bundle Concept",
      exportedFilePath,
      knowledgeBundleId: deletedBundle.id,
      okfMetadata: { type: "procedure" },
      originalSummary: "Disposable bundle concept.",
      originalTitle: "Disposable Bundle Concept",
      pageEnd: 1,
      pageStart: 1,
      reviewStatus: "approved",
      sourcePageNumbers: [1],
      summary: "Disposable bundle concept.",
      title: "Disposable Bundle Concept",
      topicType: "procedure",
      workspaceId,
    },
  });
  await db.topicDiscoveryJob.create({
    data: { documentId: document.id, status: "completed", workspaceId },
  });
  const ragJob = await db.ragIndexJob.create({
    data: {
      completedAt: new Date(),
      documentId: document.id,
      extractionJobId: extractionJob.id,
      indexVersion: 1,
      status: "completed",
      workspaceId,
    },
  });
  const chunkId = `e2e-bundle-delete-chunk-${suffix}`;
  await db.ragChunk.create({
    data: {
      chunkOrdinal: 0,
      chunkingStrategyId: "paragraph-context-v2",
      contentHash: `hash-${suffix}`,
      documentId: document.id,
      headingPath: ["Disposable"],
      id: chunkId,
      indexJobId: ragJob.id,
      indexVersion: 1,
      isActive: true,
      pageEnd: 1,
      pageStart: 1,
      reviewStatus: "raw_extracted",
      sourcePageNumbers: [1],
      sourceType: "raw_extraction",
      text: "Derived search content that must be removed.",
      tokenCount: 8,
      workspaceId,
    },
  });
  await db.okfConceptChunkLink.create({
    data: {
      chunkId,
      coverageType: "direct",
      knowledgeBundleId: deletedBundle.id,
      okfConceptId: topic.id,
      workspaceId,
    },
  });
  await db.okfConceptLifecycle.create({
    data: {
      changedBy: memberId,
      filePath: exportedFilePath,
      knowledgeBundleId: deletedBundle.id,
      status: "active",
      topicId: topic.id,
      workspaceId,
    },
  });
  await db.okfRelationCandidate.create({
    data: {
      knowledgeBundleId: deletedBundle.id,
      reason: "Disposable candidate",
      relation: "routes_to",
      sourceFile: exportedFilePath,
      targetFile: "concepts/procedure/missing.md",
      workspaceId,
    },
  });
  const session = await db.chatSession.create({
    data: {
      knowledgeBundles: {
        create: {
          knowledgeBundleId: deletedBundle.id,
          position: 0,
          selectedBy: memberId,
        },
      },
      primaryKnowledgeBundleId: deletedBundle.id,
      title: "Disposable bundle chat",
      userId: memberId,
      workspaceId,
    },
  });
  await db.chatMessage.create({
    data: {
      citations: [{ documentId: document.id, documentTitle: document.title, sourcePages: [1], sourceType: "raw_rag" }],
      content: "Disposable answer",
      knowledgeBundleIds: [deletedBundle.id],
      role: "assistant",
      scopeVersion: 1,
      sessionId: session.id,
      trace: { route: "rag_only" },
      workspaceId,
    },
  });

  const conceptPath = path.join(deletedBundleRoot, ...exportedFilePath.split("/"));
  await mkdir(path.dirname(conceptPath), { recursive: true });
  await writeFile(conceptPath, "---\ntype: procedure\ntitle: Disposable Bundle Concept\nreview_status: approved\n---\n\nDisposable.\n", "utf8");

  const queuedPayloads: string[] = [];
  const [job, duplicate] = await Promise.all([
    requestKnowledgeBundleDeletion({
      actorId: memberId,
      bundleId: deletedBundle.id,
      enqueue: async ({ jobId }) => { queuedPayloads.push(jobId); },
      workspaceId,
    }),
    requestKnowledgeBundleDeletion({
      actorId: memberId,
      bundleId: deletedBundle.id,
      enqueue: async ({ jobId }) => { queuedPayloads.push(jobId); },
      workspaceId,
    }),
  ]);
  assert.equal(duplicate.id, job.id);
  assert.deepEqual(new Set(queuedPayloads), new Set([job.id]));

  const immediatelyUnassigned = await db.document.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(immediatelyUnassigned.knowledgeBundleId, null);
  assert.equal(immediatelyUnassigned.ragStatus, "not_indexed");
  assert.equal(await db.ragChunk.count({ where: { documentId: document.id, isActive: true } }), 0);

  await runKnowledgeBundleDeletionJob({ jobId: job.id });

  const preservedDocument = await db.document.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(preservedDocument.knowledgeBundleId, null);
  assert.equal(await db.documentObject.count({ where: { documentId: document.id } }), 1);
  assert.equal(await db.documentCustomProperty.count({ where: { documentId: document.id } }), 1);
  assert.equal(await db.extractedPage.count({ where: { documentId: document.id } }), 1);
  assert.equal(await db.extractionJob.count({ where: { documentId: document.id } }), 1);
  assert.equal(await db.extractionLog.count({ where: { documentId: document.id } }), 1);
  assert.equal(await db.activityEvent.count({ where: { documentId: document.id } }), 1);
  assert.deepEqual(await storage.getObject(objectKey), pdfBytes);

  assert.equal(await db.knowledgeBundle.count({ where: { id: deletedBundle.id } }), 0);
  assert.equal(await db.topicRecord.count({ where: { documentId: document.id } }), 0);
  assert.equal(await db.topicDiscoveryJob.count({ where: { documentId: document.id } }), 0);
  assert.equal(await db.ragIndexJob.count({ where: { documentId: document.id } }), 0);
  assert.equal(await db.ragChunk.count({ where: { documentId: document.id } }), 0);
  assert.equal(await db.okfConceptChunkLink.count({ where: { knowledgeBundleId: deletedBundle.id } }), 0);
  assert.equal(await db.okfConceptLifecycle.count({ where: { knowledgeBundleId: deletedBundle.id } }), 0);
  assert.equal(await db.okfRelationCandidate.count({ where: { knowledgeBundleId: deletedBundle.id } }), 0);
  const preservedChat = await db.chatSession.findUniqueOrThrow({
    include: { knowledgeBundles: true },
    where: { id: session.id },
  });
  assert.equal(preservedChat.primaryKnowledgeBundleId, null);
  assert.equal(preservedChat.knowledgeBundles.length, 0);
  assert.equal(await db.chatMessage.count({ where: { sessionId: session.id } }), 1);
  const tombstonedAnswer = await db.chatMessage.findFirstOrThrow({
    where: { role: "assistant", sessionId: session.id },
  });
  assert.equal(tombstonedAnswer.content, DELETED_KNOWLEDGE_SOURCE_CHAT_ANSWER);
  assert.deepEqual(tombstonedAnswer.citations, []);
  assert.equal(tombstonedAnswer.trace, null);
  await assert.rejects(() => readFile(conceptPath, "utf8"), /ENOENT/);

  await db.document.update({
    data: { knowledgeBundleId: survivingBundle.id },
    where: { id: document.id },
  });
  assert.equal(
    (await db.document.findUniqueOrThrow({ where: { id: document.id } })).knowledgeBundleId,
    survivingBundle.id,
  );
  const audit = await db.bundleDeletionAudit.findFirstOrThrow({
    where: { bundleId: deletedBundle.id, workspaceId },
  });
  assert.equal(
    (audit.deletionCounts as { chatAnswersTombstoned?: number })
      .chatAnswersTombstoned,
    1,
  );

  console.log(JSON.stringify({
    auditCreated: Boolean(audit.id),
    bundleRemoved: true,
    concurrentRequestIdempotencyVerified: true,
    chatHistoryPreservedReadOnly: true,
    deletedBundleAnswerTombstoned: true,
    documentReassigned: true,
    documentsPreserved: 1,
    extractionHistoryPreserved: true,
    knowledgeProductsRemoved: true,
    memberDeletionVerified: true,
    sourcePdfPreserved: true,
  }, null, 2));
} finally {
  if (objectKey) await storage.deleteObject(objectKey).catch(() => undefined);
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
  if (workspaceRoot) await rm(workspaceRoot, { force: true, recursive: true });
  await db.$disconnect();
}

process.exit(0);
