import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthWorkspaceContext } from "../src/lib/auth-workspace.ts";
import {
  DELETED_CHAT_ANSWER,
  requestPermanentDocumentDeletion,
  runPermanentDocumentDeletionJob,
} from "../src/lib/document-deletion.ts";
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
const workspaceId = `e2e-delete-workspace-${suffix}`;
const userId = `e2e-delete-user-${suffix}`;
const context: AuthWorkspaceContext = { role: "admin", userId, workspaceId };
const documentTitle = `Permanent Deletion E2E ${suffix}`;
let workspaceRoot: string | null = null;
let objectKey: string | null = null;

try {
  await db.user.create({ data: { id: userId, email: `${userId}@example.invalid` } });
  await db.workspace.create({ data: { id: workspaceId, name: "Document Deletion E2E" } });
  await db.workspaceMember.create({
    data: { role: "admin", userId, workspaceId },
  });

  const bundle = await createKnowledgeBundle({
    context,
    description: "Disposable permanent-deletion verification bundle.",
    name: `Deletion E2E ${suffix}`,
    templateId: "generic",
  });
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId,
  });
  workspaceRoot = path.resolve(knowledgeRoot, "../..");

  const document = await db.document.create({
    data: {
      description: "Disposable source for permanent deletion verification.",
      fileType: "PDF",
      knowledgeBundleId: bundle.id,
      mimeType: "application/pdf",
      originalFilename: "permanent-deletion-e2e.pdf",
      owner: "E2E",
      pages: 1,
      size: "1 KB",
      sizeBytes: 1024,
      sourceType: "Uploaded PDF",
      status: "ready",
      tags: ["e2e", "deletion"],
      title: documentTitle,
      updatedLabel: "Just now",
      workspaceId,
    },
  });
  objectKey = buildDocumentObjectKey({ documentId: document.id, workspaceId });
  const pdfBytes = Buffer.from("%PDF-1.4\n% permanent deletion e2e fixture\n%%EOF\n");
  await storage.putObject({
    body: pdfBytes,
    contentType: "application/pdf",
    key: objectKey,
  });
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
    data: { documentId: document.id, key: "fixture", value: "true" },
  });
  const extractionJob = await db.extractionJob.create({
    data: { documentId: document.id, status: "completed", workspaceId },
  });
  await db.extractedPage.create({
    data: {
      charCount: 38,
      documentId: document.id,
      imageCount: 0,
      pageNumber: 1,
      tables: [],
      text: "Disposable source content for deletion.",
      workspaceId,
    },
  });
  await db.extractionLog.create({
    data: {
      documentId: document.id,
      jobId: extractionJob.id,
      level: "info",
      message: "Fixture extracted",
      workspaceId,
    },
  });
  const exportedFilePath = "concepts/procedure/permanent-deletion-e2e.md";
  const topic = await db.topicRecord.create({
    data: {
      approvalMode: "human_individual",
      approvedAt: new Date(),
      approvedBy: userId,
      approvedContentSource: "enriched",
      confidence: "high",
      documentId: document.id,
      enrichedBody: "This content must disappear with its source document.",
      enrichedSummary: "Disposable approved concept.",
      enrichedTitle: "Permanent Deletion Concept",
      enrichmentStatus: "completed",
      exportedFilePath,
      knowledgeBundleId: bundle.id,
      okfMetadata: { type: "procedure" },
      originalSummary: "Disposable approved concept.",
      originalTitle: "Permanent Deletion Concept",
      pageEnd: 1,
      pageStart: 1,
      reviewStatus: "approved",
      sourcePageNumbers: [1],
      summary: "Disposable approved concept.",
      title: "Permanent Deletion Concept",
      topicType: "procedure",
      workspaceId,
    },
  });
  const additionalTopics = await Promise.all([
    db.topicRecord.create({
      data: {
        confidence: "medium",
        documentId: document.id,
        enrichmentStatus: "none",
        exportedFilePath: "concepts/procedure/permanent-deletion-rejected.md",
        knowledgeBundleId: bundle.id,
        originalSummary: "Rejected disposable concept.",
        originalTitle: "Rejected Deletion Concept",
        pageEnd: 1,
        pageStart: 1,
        reviewStatus: "rejected",
        sourcePageNumbers: [1],
        summary: "Rejected disposable concept.",
        title: "Rejected Deletion Concept",
        topicType: "procedure",
        workspaceId,
      },
    }),
    db.topicRecord.create({
      data: {
        confidence: "high",
        documentId: document.id,
        enrichmentStatus: "completed",
        enrichedBody: "Review-pending disposable concept body.",
        enrichedSummary: "Review-pending disposable concept.",
        enrichedTitle: "Review Pending Deletion Concept",
        exportedFilePath: "concepts/procedure/permanent-deletion-review-pending.md",
        knowledgeBundleId: bundle.id,
        originalSummary: "Review-pending disposable concept.",
        originalTitle: "Review Pending Deletion Concept",
        pageEnd: 1,
        pageStart: 1,
        reviewStatus: "needs_review",
        sourcePageNumbers: [1],
        summary: "Review-pending disposable concept.",
        title: "Review Pending Deletion Concept",
        topicType: "procedure",
        workspaceId,
      },
    }),
  ]);
  const allTopics = [topic, ...additionalTopics];

  const ragIndexJob = await db.ragIndexJob.create({
    data: {
      completedAt: new Date(),
      documentId: document.id,
      extractionJobId: extractionJob.id,
      indexVersion: 1,
      status: "completed",
      workspaceId,
    },
  });
  const chunkId = `e2e-delete-chunk-${suffix}`;
  await db.ragChunk.create({
    data: {
      chunkOrdinal: 0,
      chunkingStrategyId: "paragraph-context-v2",
      contentHash: `hash-${suffix}`,
      documentId: document.id,
      headingPath: ["Permanent Deletion"],
      id: chunkId,
      indexJobId: ragIndexJob.id,
      indexVersion: 1,
      isActive: true,
      pageEnd: 1,
      pageStart: 1,
      reviewStatus: "raw_extracted",
      sourcePageNumbers: [1],
      sourceType: "raw_extraction",
      text: "Disposable source content for deletion.",
      tokenCount: 7,
      workspaceId,
    },
  });
  const zeroVector = `[${Array.from({ length: 1536 }, () => "0").join(",")}]`;
  const ragEmbeddingId = `e2e-delete-rag-embedding-${suffix}`;
  await db.$executeRaw`
    INSERT INTO "RagEmbedding"
      ("id", "workspaceId", "chunkId", "model", "dimensions", "tokenCount", "embedding")
    VALUES
      (${ragEmbeddingId}, ${workspaceId}, ${chunkId}, 'text-embedding-3-small', 1536, 7, ${zeroVector}::vector)
  `;
  await db.okfConceptChunkLink.create({
    data: {
      chunkId,
      coverageType: "direct",
      knowledgeBundleId: bundle.id,
      okfConceptId: topic.id,
      workspaceId,
    },
  });
  await db.okfConceptLifecycle.create({
    data: {
      changedBy: userId,
      filePath: exportedFilePath,
      knowledgeBundleId: bundle.id,
      status: "active",
      topicId: topic.id,
      workspaceId,
    },
  });
  await db.okfConceptEmbeddingJob.create({
    data: {
      bundleName: bundle.name,
      contentHash: `okf-hash-${suffix}`,
      filePath: exportedFilePath,
      knowledgeBundleId: bundle.id,
      status: "completed",
      workspaceId,
    },
  });
  const okfEmbeddingId = `e2e-delete-okf-embedding-${suffix}`;
  await db.$executeRaw`
    INSERT INTO "OkfConceptEmbedding"
      ("id", "workspaceId", "knowledgeBundleId", "filePath", "contentHash", "model", "dimensions", "tokenCount", "embedding", "updatedAt")
    VALUES
      (${okfEmbeddingId}, ${workspaceId}, ${bundle.id}, ${exportedFilePath}, ${`okf-hash-${suffix}`}, 'text-embedding-3-small', 1536, 12, ${zeroVector}::vector, NOW())
  `;
  await db.okfRelationCandidate.create({
    data: {
      knowledgeBundleId: bundle.id,
      reason: "Disposable relation candidate",
      relation: "routes_to",
      sourceFile: exportedFilePath,
      targetFile: "concepts/procedure/other.md",
      workspaceId,
    },
  });
  await db.activityEvent.create({
    data: {
      documentId: document.id,
      documentTitle,
      label: "Fixture created",
      status: "Complete",
      timestamp: new Date().toISOString(),
      workspaceId,
    },
  });

  const session = await db.chatSession.create({
    data: {
      knowledgeBundles: {
        create: {
          knowledgeBundleId: bundle.id,
          position: 0,
          selectedBy: userId,
        },
      },
      primaryKnowledgeBundleId: bundle.id,
      title: "Deletion citation fixture",
      userId,
      workspaceId,
    },
  });
  const assistantMessage = await db.chatMessage.create({
    data: {
      citations: [{
        documentId: document.id,
        documentTitle,
        okfFilePath: exportedFilePath,
        sourcePages: [1],
        sourceType: "okf_topic",
      }],
      content: "This answer is supported by the disposable document. **1**",
      role: "assistant",
      sessionId: session.id,
      trace: { route: "okf_only" },
      workspaceId,
    },
  });
  await db.knowledgeGap.create({
    data: {
      assistantMessageId: assistantMessage.id,
      chatSessionId: session.id,
      finalEvidenceStatus: "related_evidence_only",
      primaryKnowledgeBundleId: bundle.id,
      searchedKnowledgeBundleIds: [bundle.id],
      question: "Disposable question",
      reason: "Fixture gap",
      retrievalQuery: "disposable",
      route: "okf_only",
      searchedSources: ["okf"],
      workspaceId,
    },
  });

  const exportedFiles = allTopics.map((entry) => entry.exportedFilePath!);
  const conceptPaths = exportedFiles.map((filePath) =>
    path.join(knowledgeRoot, ...filePath.split("/")),
  );
  await mkdir(path.dirname(conceptPaths[0]!), { recursive: true });
  await Promise.all(conceptPaths.map((conceptPath, index) =>
    writeFile(conceptPath, `---\ntype: procedure\ntitle: ${allTopics[index]!.title}\ndescription: Disposable concept.\nreview_status: ${allTopics[index]!.reviewStatus}\nsource_file: ${JSON.stringify(documentTitle)}\nsource_pages: [1]\nupdated: 2026-07-21\n---\n\nThis content must disappear with its source document.\n`, "utf8"),
  ));
  await writeFile(path.join(knowledgeRoot, "index.md"), `# Knowledge Index\n\n${allTopics.map((entry) => `- [${entry.title}](${entry.exportedFilePath})`).join("\n")}\n`, "utf8");
  await writeFile(path.join(knowledgeRoot, "source_manifest.md"), `# Source Manifest\n\n- ${documentTitle}\n  - source: permanent-deletion-e2e.pdf\n`, "utf8");
  await writeFile(path.join(knowledgeRoot, "log.md"), `# Change Log\n\n${exportedFiles.map((filePath) => `- 2026-07-21 - export - ${filePath}`).join("\n")}\n`, "utf8");

  await assert.rejects(
    () => requestPermanentDocumentDeletion({
      context: { ...context, role: "member" },
      documentId: document.id,
      enqueue: async () => undefined,
    }),
    /document_deletion_admin_required/,
  );
  await assert.rejects(
    () => requestPermanentDocumentDeletion({
      context: { ...context, workspaceId: `other-${workspaceId}` },
      documentId: document.id,
      enqueue: async () => undefined,
    }),
    /document_not_found/,
  );
  const queuedJobIds: string[] = [];
  const [deletionJob, concurrentJob] = await Promise.all([
    requestPermanentDocumentDeletion({
      context,
      documentId: document.id,
      enqueue: async (payload) => { queuedJobIds.push(payload.jobId); },
    }),
    requestPermanentDocumentDeletion({
      context,
      documentId: document.id,
      enqueue: async (payload) => { queuedJobIds.push(payload.jobId); },
    }),
  ]);
  assert.equal(concurrentJob.id, deletionJob.id);
  assert.deepEqual(new Set(queuedJobIds), new Set([deletionJob.id]));
  assert.equal(await db.documentDeletionJob.count({ where: { documentId: document.id } }), 1);
  const hiddenDocument = await db.document.findUniqueOrThrow({ where: { id: document.id } });
  assert(hiddenDocument.deletedAt, "document must become unavailable immediately");
  assert.equal(hiddenDocument.status, "deleting");
  assert.equal(await db.ragChunk.count({ where: { documentId: document.id, isActive: true } }), 0);

  await runPermanentDocumentDeletionJob({ jobId: deletionJob.id }, { storage });

  const directCounts = await Promise.all([
    db.document.count({ where: { id: document.id } }),
    db.documentObject.count({ where: { documentId: document.id } }),
    db.extractedPage.count({ where: { documentId: document.id } }),
    db.extractionJob.count({ where: { documentId: document.id } }),
    db.topicRecord.count({ where: { documentId: document.id } }),
    db.ragIndexJob.count({ where: { documentId: document.id } }),
    db.ragChunk.count({ where: { documentId: document.id } }),
    db.ragEmbedding.count({ where: { chunkId } }),
    db.okfConceptChunkLink.count({ where: { okfConceptId: topic.id } }),
    db.okfConceptEmbedding.count({ where: { knowledgeBundleId: bundle.id, filePath: exportedFilePath } }),
    db.okfConceptEmbeddingJob.count({ where: { knowledgeBundleId: bundle.id, filePath: exportedFilePath } }),
    db.okfConceptLifecycle.count({ where: { knowledgeBundleId: bundle.id, filePath: exportedFilePath } }),
    db.okfRelationCandidate.count({ where: { knowledgeBundleId: bundle.id, sourceFile: exportedFilePath } }),
    db.activityEvent.count({ where: { documentId: document.id } }),
    db.documentDeletionJob.count({ where: { id: deletionJob.id } }),
  ]);
  assert.deepEqual(directCounts, Array.from({ length: directCounts.length }, () => 0));
  await assert.rejects(() => storage.getObject(objectKey!), /NoSuchKey|not exist|specified key/i);
  for (const conceptPath of conceptPaths) {
    await assert.rejects(() => readFile(conceptPath, "utf8"), /ENOENT/);
  }

  const [index, manifest, log, tombstonedMessage] = await Promise.all([
    readFile(path.join(knowledgeRoot, "index.md"), "utf8"),
    readFile(path.join(knowledgeRoot, "source_manifest.md"), "utf8"),
    readFile(path.join(knowledgeRoot, "log.md"), "utf8"),
    db.chatMessage.findUniqueOrThrow({ where: { id: assistantMessage.id } }),
  ]);
  assert.doesNotMatch(index, new RegExp(exportedFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(manifest, new RegExp(documentTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(log, / - export - concepts\/procedure\/permanent-deletion/);
  assert.match(log, /permanent-document-deletion/);
  assert.match(log, /objects: 1/);
  assert.match(log, /topics: 3/);
  assert.match(log, /concept_files: 3/);
  assert.match(log, /rag_chunks: 1/);
  assert.match(log, /chat_answers: 1/);
  assert.equal(tombstonedMessage.content, DELETED_CHAT_ANSWER);
  assert.deepEqual(tombstonedMessage.citations, []);
  assert.equal(tombstonedMessage.trace, null);
  assert.equal(await db.knowledgeGap.count({ where: { assistantMessageId: assistantMessage.id } }), 0);

  console.log(JSON.stringify({
    assistantAnswersTombstoned: 1,
    conceptFilesRemoved: 3,
    concurrentRequestIdempotencyVerified: true,
    databaseCascadeVerified: true,
    deletionJobRemoved: true,
    documentId: document.id,
    minioObjectsRemoved: 1,
    ragChunksRemoved: 1,
    topicsRemoved: 3,
    workspaceAuthorizationVerified: true,
  }, null, 2));
} finally {
  if (objectKey) await storage.deleteObject(objectKey).catch(() => undefined);
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: userId } });
  if (workspaceRoot) await rm(workspaceRoot, { force: true, recursive: true });
  await db.$disconnect();
}

process.exit(0);
