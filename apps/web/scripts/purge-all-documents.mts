import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "../src/lib/auth-workspace.ts";
import {
  closeDocumentDeletionQueue,
  DELETED_CHAT_ANSWER,
  requestPermanentDocumentDeletion,
  retryPermanentDocumentDeletion,
} from "../src/lib/document-deletion.ts";
import {
  ALL_DOCUMENTS_PURGE_CONFIRMATION,
  buildDocumentPurgeInventory,
  isRuntimeDocumentObjectKey,
  parseDocumentPurgeOptions,
  shouldPurgeRuntimeKnowledgeFile,
} from "../src/lib/document-purge.ts";
import { resolveKnowledgeBundleRoot } from "../src/lib/knowledge-bundles.ts";
import { resolveKnowledgePath } from "../src/lib/knowledge-root.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import { getObjectStorage } from "../src/lib/production-storage.ts";

const MAINTENANCE_ACTOR = "maintenance:all-workspace-document-purge";
const options = parseDocumentPurgeOptions(process.argv.slice(2));
const db = getPrisma();

try {
  const documents = await listDocuments();
  const inventory = buildDocumentPurgeInventory(documents.map((document) => ({
    knowledgeBundleId: document.knowledgeBundleId,
    objectCount: document._count.objects,
    topicCount: document._count.topicRecords,
    workspaceId: document.workspaceId,
  })));

  if (!options.apply) {
    printReport({
      apply: false,
      confirmationRequired: ALL_DOCUMENTS_PURGE_CONFIRMATION,
      inventory,
      status: "dry_run",
    });
    process.exit(0);
  }

  if (documents.length === 0) {
    const finalization = await resetRuntimeDocumentKnowledge();
    const verification = await buildVerification();
    printReport({
      apply: true,
      finalization,
      inventory,
      ...verification,
      status: verification.clean
        ? "completed_no_changes"
        : "verification_failed",
    });
    if (!verification.clean) process.exitCode = 1;
  } else {
    for (const document of documents) {
      const context = maintenanceContext(document.workspaceId);
      const existing = await db.documentDeletionJob.findUnique({
        where: { documentId: document.id },
      });
      if (existing?.status === "failed") {
        await retryPermanentDocumentDeletion({ context, jobId: existing.id });
        continue;
      }
      await requestPermanentDocumentDeletion({ context, documentId: document.id });
    }

    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const jobs = await db.documentDeletionJob.findMany({
        orderBy: [{ workspaceId: "asc" }, { queuedAt: "asc" }, { id: "asc" }],
        select: {
          documentId: true,
          documentTitle: true,
          errorCode: true,
          errorMessage: true,
          id: true,
          status: true,
          workspaceId: true,
        },
      });
      const failed = jobs.filter((job) => job.status === "failed");
      if (failed.length > 0) {
        printReport({
          apply: true,
          failed,
          inventory,
          remainingDocuments: await db.document.count(),
          remainingJobs: jobs.length,
          status: "failed",
        });
        process.exitCode = 1;
        break;
      }

      const remainingDocuments = await db.document.count();
      if (remainingDocuments === 0 && jobs.length === 0) {
        const finalization = await resetRuntimeDocumentKnowledge();
        const verification = await buildVerification();
        printReport({
          apply: true,
          finalization,
          inventory,
          ...verification,
          status: verification.clean ? "completed" : "verification_failed",
        });
        if (!verification.clean) process.exitCode = 1;
        break;
      }

      await wait(options.pollMs);
    }

    if (Date.now() >= deadline && process.exitCode !== 1) {
      printReport({
        apply: true,
        inventory,
        remainingDocuments: await db.document.count(),
        remainingJobs: await db.documentDeletionJob.count(),
        status: "timed_out",
      });
      process.exitCode = 1;
    }
  }
} finally {
  if (options.apply) await closeDocumentDeletionQueue();
  await db.$disconnect();
}

async function listDocuments() {
  return db.document.findMany({
    orderBy: [{ workspaceId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      _count: { select: { objects: true, topicRecords: true } },
      id: true,
      knowledgeBundleId: true,
      title: true,
      workspaceId: true,
    },
  });
}

async function buildVerification() {
  const bundles = await db.knowledgeBundle.findMany({
    orderBy: [{ workspaceId: "asc" }, { id: "asc" }],
    select: { id: true, workspaceId: true },
  });
  let runtimeKnowledgeFiles = 0;
  for (const bundle of bundles) {
    const root = resolveKnowledgeBundleRoot({
      bundleId: bundle.id,
      workspaceId: bundle.workspaceId,
    });
    runtimeKnowledgeFiles += (await listMarkdownFiles(root)).filter(
      shouldPurgeRuntimeKnowledgeFile,
    ).length;
  }
  const storage = getObjectStorage();
  if (!storage.listObjectKeys) throw new Error("document_purge_storage_listing_unavailable");
  const runtimeDocumentObjects = (await storage.listObjectKeys("workspaces/"))
    .filter(isRuntimeDocumentObjectKey).length;
  const assistantMessages = await db.chatMessage.findMany({
    select: { citations: true },
    where: { role: "assistant" },
  });
  const counts = {
    authoringRuns: await db.knowledgeAuthoringRun.count(),
    authoringStageAudits: await db.knowledgeAuthoringStageAudit.count(),
    bulkApprovalRuns: await db.bulkTopicApprovalRun.count(),
    citationBearingAssistantMessages: assistantMessages.filter(
      (message) => Array.isArray(message.citations) && message.citations.length > 0,
    ).length,
    deletionJobs: await db.documentDeletionJob.count(),
    documentActivityEvents: await db.activityEvent.count({
      where: { documentId: { not: null } },
    }),
    documentCustomProperties: await db.documentCustomProperty.count(),
    documentMetadataProposals: await db.documentMetadataProposal.count(),
    documentObjects: await db.documentObject.count(),
    documents: await db.document.count(),
    extractedPages: await db.extractedPage.count(),
    extractionJobs: await db.extractionJob.count(),
    extractionLogs: await db.extractionLog.count(),
    lifecycles: await db.okfConceptLifecycle.count(),
    okfConceptChunkLinks: await db.okfConceptChunkLink.count(),
    okfEmbeddingJobs: await db.okfConceptEmbeddingJob.count(),
    okfEmbeddings: await db.okfConceptEmbedding.count(),
    ragChunks: await db.ragChunk.count(),
    ragEmbeddings: await db.ragEmbedding.count(),
    ragIndexJobs: await db.ragIndexJob.count(),
    relationCandidates: await db.okfRelationCandidate.count(),
    relationDiscoveryRuns: await db.okfRelationDiscoveryRun.count(),
    runtimeDocumentObjects,
    runtimeKnowledgeFiles,
    topicDiscoveryJobs: await db.topicDiscoveryJob.count(),
    topicDiscoveryAudits: await db.topicDiscoveryAudit.count(),
    topicEnrichmentAudits: await db.topicEnrichmentAudit.count(),
    topicRecords: await db.topicRecord.count(),
  };
  return {
    clean: Object.values(counts).every((count) => count === 0),
    counts,
    remainingDocuments: counts.documents,
    remainingJobs: counts.deletionJobs,
  };
}

async function resetRuntimeDocumentKnowledge() {
  const bundles = await db.knowledgeBundle.findMany({
    orderBy: [{ workspaceId: "asc" }, { id: "asc" }],
    select: { id: true, name: true, workspaceId: true },
  });
  let filesRemoved = 0;
  for (const bundle of bundles) {
    const root = resolveKnowledgeBundleRoot({
      bundleId: bundle.id,
      workspaceId: bundle.workspaceId,
    });
    const removableFiles = (await listMarkdownFiles(root)).filter(
      shouldPurgeRuntimeKnowledgeFile,
    );
    for (const filePath of removableFiles) {
      const target = await resolveKnowledgePath({
        knowledgeRoot: root,
        relativePath: filePath,
      });
      if (!target) throw new Error("document_purge_unsafe_knowledge_path");
      await rm(target, { force: true });
      filesRemoved += 1;
    }
    await mkdir(path.join(root, "references", "sources"), { recursive: true });
    await writeFile(
      path.join(root, "index.md"),
      [
        "---",
        'okf_version: "0.2"',
        "---",
        "",
        `# ${singleLine(bundle.name)}`,
        "",
      ].join("\n"),
      "utf8",
    );
    if (removableFiles.length > 0) {
      await appendPurgeLog(root, removableFiles.length);
    }
  }

  const storage = getObjectStorage();
  if (!storage.listObjectKeys) throw new Error("document_purge_storage_listing_unavailable");
  const objectKeys = (await storage.listObjectKeys("workspaces/"))
    .filter(isRuntimeDocumentObjectKey);
  for (const objectKey of objectKeys) await storage.deleteObject(objectKey);

  const assistantMessages = await db.chatMessage.findMany({
    select: { citations: true, id: true },
    where: { role: "assistant" },
  });
  const affectedMessageIds = assistantMessages.flatMap((message) =>
    Array.isArray(message.citations) && message.citations.length > 0
      ? [message.id]
      : [],
  );

  await db.$transaction(async (tx) => {
    if (affectedMessageIds.length > 0) {
      await tx.knowledgeGap.deleteMany({
        where: { assistantMessageId: { in: affectedMessageIds } },
      });
      await tx.chatMessage.updateMany({
        data: {
          citations: [] as unknown as Prisma.InputJsonValue,
          content: DELETED_CHAT_ANSWER,
          trace: Prisma.JsonNull,
        },
        where: { id: { in: affectedMessageIds } },
      });
    }
    await tx.bulkTopicApprovalRun.deleteMany();
    await tx.okfConceptChunkLink.deleteMany();
    await tx.okfConceptEmbeddingJob.deleteMany();
    await tx.okfConceptEmbedding.deleteMany();
    await tx.okfConceptLifecycle.deleteMany();
    await tx.okfRelationCandidate.deleteMany();
    await tx.okfRelationDiscoveryRun.deleteMany();
  });

  return {
    assistantAnswersTombstoned: affectedMessageIds.length,
    filesRemoved,
    objectsRemoved: objectKeys.length,
  };
}

async function listMarkdownFiles(root: string) {
  const files: string[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (isMissingPathError(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(root, fullPath).replaceAll(path.sep, "/"));
      }
    }
  }
  await walk(root);
  return files.sort();
}

async function appendPurgeLog(root: string, removedFiles: number) {
  const logPath = path.join(root, "log.md");
  const entry = `- ${new Date().toISOString()} - all-workspace-document-purge - removed ${removedFiles} orphaned knowledge files`;
  const existing = await readFile(logPath, "utf8").catch((error) => {
    if (isMissingPathError(error)) return "# Change Log\n";
    throw error;
  });
  await writeFile(logPath, `${existing.trimEnd()}\n\n${entry}\n`, "utf8");
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim() || "Knowledge Bundle";
}

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}

function maintenanceContext(workspaceId: string): AuthWorkspaceContext {
  return {
    role: "admin",
    userId: MAINTENANCE_ACTOR,
    workspaceId,
  };
}

function printReport(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
