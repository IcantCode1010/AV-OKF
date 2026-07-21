import { createHash } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
import type { TopicRelation } from "./okf-relations.ts";
import { getFrontmatterRelations, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { queueOkfConceptEmbedding } from "./okf-concept-embedding.ts";
import { getPrisma } from "./prisma.ts";
import { getObjectStorage, type ObjectStorage } from "./production-storage.ts";

export const DELETED_CHAT_ANSWER =
  "This answer was removed because its supporting source was permanently deleted.";

export type DocumentDeletionJobPayload = {
  jobId: string;
};

export type DocumentDeletionManifest = {
  counts?: {
    chatAnswers: number;
    conceptFiles: number;
    ragChunks: number;
  };
  documentId: string;
  documentTitle: string;
  exportedFilePaths: string[];
  knowledgeBundleId: string;
  objectKeys: string[];
  requestedAt: string;
  survivorFilesChanged?: string[];
  topicIds: string[];
  workspaceId: string;
};

export type DocumentDeletionStatus = {
  documentId: string;
  documentTitle: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  status: string;
};

export type DocumentDeletionStatusSnapshot = {
  active: boolean;
  fingerprint: string;
  jobs: DocumentDeletionStatus[];
};

type EnqueueDeletion = (payload: DocumentDeletionJobPayload) => Promise<void>;

let cachedQueue: Queue<DocumentDeletionJobPayload> | null = null;

export function getDocumentDeletionQueue() {
  if (!cachedQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("missing_env_REDIS_URL");
    cachedQueue = new Queue<DocumentDeletionJobPayload>("document-deletion", {
      connection: { url: redisUrl },
    });
  }
  return cachedQueue;
}

export async function enqueueDocumentDeletionJob(
  payload: DocumentDeletionJobPayload,
) {
  await getDocumentDeletionQueue().add("delete-document", payload, {
    attempts: 5,
    backoff: { delay: 2_000, type: "exponential" },
    jobId: `delete-document-${payload.jobId}`,
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export async function requestPermanentDocumentDeletion(input: {
  context: AuthWorkspaceContext;
  documentId: string;
  enqueue?: EnqueueDeletion;
}) {
  if (input.context.role !== "admin") {
    throw new Error("document_deletion_admin_required");
  }

  const db = getPrisma();
  const existing = await db.documentDeletionJob.findUnique({
    where: { documentId: input.documentId },
  });
  if (existing) {
    assertDeletionWorkspace(existing.workspaceId, input.context.workspaceId);
    await (input.enqueue ?? enqueueDocumentDeletionJob)({ jobId: existing.id });
    return existing;
  }

  const document = await db.document.findFirst({
    include: {
      objects: { select: { objectKey: true } },
      topicRecords: { select: { exportedFilePath: true, id: true } },
    },
    where: {
      id: input.documentId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!document) throw new Error("document_not_found");

  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: document.knowledgeBundleId,
    workspaceId: document.workspaceId,
  });
  const exportedFilePaths = await resolveExportedFilePaths({
    explicitPaths: document.topicRecords.flatMap((topic) =>
      topic.exportedFilePath ? [topic.exportedFilePath] : [],
    ),
    knowledgeRoot,
    topicIds: document.topicRecords.map((topic) => topic.id),
  });
  const manifest: DocumentDeletionManifest = {
    documentId: document.id,
    documentTitle: document.title,
    exportedFilePaths,
    knowledgeBundleId: document.knowledgeBundleId,
    objectKeys: document.objects.map((object) => object.objectKey),
    requestedAt: new Date().toISOString(),
    topicIds: document.topicRecords.map((topic) => topic.id),
    workspaceId: document.workspaceId,
  };

  let job;
  try {
    job = await db.$transaction(async (tx) => {
      const created = await tx.documentDeletionJob.create({
        data: {
          documentId: document.id,
          documentTitle: document.title,
          knowledgeBundleId: document.knowledgeBundleId,
          manifest: manifest as unknown as Prisma.InputJsonValue,
          requestedBy: input.context.userId,
          workspaceId: document.workspaceId,
        },
      });
      await tx.document.update({
        data: {
          deletedAt: new Date(manifest.requestedAt),
          deletedBy: input.context.userId,
          deleteReason: "Permanent deletion requested",
          status: "deleting",
        },
        where: { id: document.id },
      });
      await tx.ragChunk.updateMany({
        data: { isActive: false },
        where: { documentId: document.id, workspaceId: document.workspaceId },
      });
      for (const filePath of exportedFilePaths) {
        await tx.okfConceptLifecycle.upsert({
          create: {
            changedAt: new Date(manifest.requestedAt),
            changedBy: input.context.userId,
            filePath,
            knowledgeBundleId: document.knowledgeBundleId,
            reason: "Permanent source-document deletion in progress",
            status: "deleting",
            workspaceId: document.workspaceId,
          },
          update: {
            changedAt: new Date(manifest.requestedAt),
            changedBy: input.context.userId,
            reason: "Permanent source-document deletion in progress",
            status: "deleting",
          },
          where: {
            knowledgeBundleId_filePath: {
              filePath,
              knowledgeBundleId: document.knowledgeBundleId,
            },
          },
        });
      }
      return created;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    job = await db.documentDeletionJob.findUnique({
      where: { documentId: document.id },
    });
    if (!job) throw error;
  }

  await (input.enqueue ?? enqueueDocumentDeletionJob)({ jobId: job.id });
  return job;
}

export async function retryPermanentDocumentDeletion(input: {
  context: AuthWorkspaceContext;
  jobId: string;
  enqueue?: EnqueueDeletion;
}) {
  if (input.context.role !== "admin") {
    throw new Error("document_deletion_admin_required");
  }
  const db = getPrisma();
  const job = await db.documentDeletionJob.findFirst({
    where: { id: input.jobId, workspaceId: input.context.workspaceId },
  });
  if (!job) throw new Error("document_deletion_job_not_found");
  await db.documentDeletionJob.update({
    data: { errorCode: null, errorMessage: null, status: "queued" },
    where: { id: job.id },
  });
  await (input.enqueue ?? enqueueDocumentDeletionJob)({ jobId: job.id });
}

export async function listDocumentDeletionJobs(
  context: AuthWorkspaceContext,
): Promise<DocumentDeletionStatus[]> {
  if (context.role !== "admin") return [];
  return getPrisma().documentDeletionJob.findMany({
    orderBy: [{ queuedAt: "desc" }, { id: "asc" }],
    select: {
      documentId: true,
      documentTitle: true,
      errorCode: true,
      errorMessage: true,
      id: true,
      status: true,
    },
    where: { workspaceId: context.workspaceId },
  });
}

export async function getDocumentDeletionStatusSnapshot(
  context: AuthWorkspaceContext,
): Promise<DocumentDeletionStatusSnapshot> {
  return buildDocumentDeletionStatusSnapshot(
    await listDocumentDeletionJobs(context),
  );
}

export function buildDocumentDeletionStatusSnapshot(
  jobs: DocumentDeletionStatus[],
): DocumentDeletionStatusSnapshot {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        jobs
          .map((job) => ({
            errorCode: job.errorCode,
            errorMessage: job.errorMessage,
            id: job.id,
            status: job.status,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    )
    .digest("hex");

  return {
    active: jobs.some((job) => ["queued", "running"].includes(job.status)),
    fingerprint,
    jobs,
  };
}

export async function reconcileDocumentDeletionJobs(
  enqueue: EnqueueDeletion = enqueueDocumentDeletionJob,
) {
  const jobs = await getPrisma().documentDeletionJob.findMany({
    select: { id: true },
    where: { status: { in: ["queued", "running"] } },
  });
  for (const job of jobs) await enqueue({ jobId: job.id });
  return jobs.length;
}

export async function runPermanentDocumentDeletionJob(
  payload: DocumentDeletionJobPayload,
  options: { storage?: ObjectStorage } = {},
) {
  const db = getPrisma();
  const job = await db.documentDeletionJob.findUnique({ where: { id: payload.jobId } });
  if (!job) return;
  const manifest = parseDeletionManifest(job.manifest);
  const storage = options.storage ?? getObjectStorage();

  await db.documentDeletionJob.update({
    data: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      status: "running",
    },
    where: { id: job.id },
  });

  try {
    const ragChunkCount = manifest.counts?.ragChunks ?? await db.ragChunk.count({
      where: { documentId: manifest.documentId, workspaceId: manifest.workspaceId },
    });
    const bundleResult = await cleanDocumentFromKnowledgeBundle(manifest);
    for (const objectKey of manifest.objectKeys) await storage.deleteObject(objectKey);

    const assistantMessages = await db.chatMessage.findMany({
      select: { citations: true, id: true },
      where: { role: "assistant", workspaceId: manifest.workspaceId },
    });
    const affectedMessageIds = assistantMessages
      .filter((message) =>
        citationsReferenceDocument(
          message.citations,
          manifest.documentId,
          manifest.exportedFilePaths,
        ),
      )
      .map((message) => message.id);
    const counts = {
      chatAnswers: manifest.counts?.chatAnswers ?? affectedMessageIds.length,
      conceptFiles: manifest.counts?.conceptFiles ?? bundleResult.deletedFiles,
      ragChunks: ragChunkCount,
    };
    const survivorFilesChanged = Array.from(new Set([
      ...(manifest.survivorFilesChanged ?? []),
      ...bundleResult.changedSurvivors.map((entry) => entry.filePath),
    ])).sort();
    const updatedManifest = { ...manifest, counts, survivorFilesChanged };
    await db.documentDeletionJob.update({
      data: { manifest: updatedManifest as unknown as Prisma.InputJsonValue },
      where: { id: job.id },
    });
    const affectedRunIds = (
      await db.bulkTopicApprovalItem.findMany({
        select: { runId: true },
        where: { documentId: manifest.documentId },
      })
    ).map((item) => item.runId);

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
      await tx.okfRelationCandidate.deleteMany({
        where: {
          knowledgeBundleId: manifest.knowledgeBundleId,
          OR: [
            { sourceFile: { in: manifest.exportedFilePaths } },
            { targetFile: { in: manifest.exportedFilePaths } },
          ],
        },
      });
      await tx.okfConceptChunkLink.deleteMany({
        where: {
          knowledgeBundleId: manifest.knowledgeBundleId,
          okfConceptId: { in: manifest.topicIds },
        },
      });
      await tx.okfConceptEmbedding.deleteMany({
        where: {
          filePath: { in: manifest.exportedFilePaths },
          knowledgeBundleId: manifest.knowledgeBundleId,
        },
      });
      await tx.okfConceptEmbeddingJob.deleteMany({
        where: {
          filePath: { in: manifest.exportedFilePaths },
          knowledgeBundleId: manifest.knowledgeBundleId,
        },
      });
      await tx.okfConceptLifecycle.deleteMany({
        where: {
          filePath: { in: manifest.exportedFilePaths },
          knowledgeBundleId: manifest.knowledgeBundleId,
        },
      });
      await tx.activityEvent.deleteMany({ where: { documentId: manifest.documentId } });
      await tx.document.deleteMany({
        where: { id: manifest.documentId, workspaceId: manifest.workspaceId },
      });
      for (const runId of new Set(affectedRunIds)) {
        const remaining = await tx.bulkTopicApprovalItem.count({ where: { runId } });
        if (remaining === 0) {
          await tx.bulkTopicApprovalRun.deleteMany({ where: { id: runId } });
        }
      }
    });

    for (const filePath of survivorFilesChanged) {
      const target = await resolveKnowledgePath({
        knowledgeRoot: bundleResult.knowledgeRoot,
        relativePath: filePath,
      });
      if (!target) throw new Error("document_deletion_unsafe_knowledge_path");
      await queueOkfConceptEmbedding({
        bundleName: bundleResult.bundleName,
        filePath,
        knowledgeBundleId: manifest.knowledgeBundleId,
        markdown: await readFile(target, "utf8"),
        workspaceId: manifest.workspaceId,
      });
    }
    await appendDeletionLog({
      chatAnswers: counts.chatAnswers,
      conceptFiles: counts.conceptFiles,
      documentTitle: manifest.documentTitle,
      knowledgeRoot: bundleResult.knowledgeRoot,
      objects: manifest.objectKeys.length,
      ragChunks: ragChunkCount,
      timestamp: manifest.requestedAt,
      topics: manifest.topicIds.length,
    });
    await db.documentDeletionJob.deleteMany({ where: { id: job.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.documentDeletionJob.updateMany({
      data: {
        errorCode: "document_deletion_failed",
        errorMessage: message,
        status: "failed",
      },
      where: { id: job.id },
    });
    throw error;
  }
}

async function cleanDocumentFromKnowledgeBundle(manifest: DocumentDeletionManifest) {
  const db = getPrisma();
  const bundle = await db.knowledgeBundle.findFirst({
    select: { name: true },
    where: {
      id: manifest.knowledgeBundleId,
      workspaceId: manifest.workspaceId,
    },
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: manifest.knowledgeBundleId,
    workspaceId: manifest.workspaceId,
  });
  const deleted = new Set(manifest.exportedFilePaths.map(normalizeBundlePath));
  let deletedFiles = 0;
  for (const filePath of deleted) {
    const target = await resolveKnowledgePath({ knowledgeRoot, relativePath: filePath });
    if (!target) throw new Error("document_deletion_unsafe_knowledge_path");
    const existed = await readFile(target, "utf8").then(() => true).catch((error) => {
      if (isMissingPathError(error)) return false;
      throw error;
    });
    await rm(target, { force: true });
    if (existed) deletedFiles += 1;
  }

  await removeLinesReferencingFiles(path.join(knowledgeRoot, "index.md"), deleted);
  await removeLinesReferencingFiles(path.join(knowledgeRoot, "log.md"), deleted);
  const sameTitleSurvives = await db.document.count({
    where: {
      deletedAt: null,
      id: { not: manifest.documentId },
      knowledgeBundleId: manifest.knowledgeBundleId,
      title: manifest.documentTitle,
      topicRecords: { some: { exportedFilePath: { not: null } } },
    },
  });
  if (sameTitleSurvives === 0) {
    await removeSourceManifestEntry(
      path.join(knowledgeRoot, "source_manifest.md"),
      manifest.documentTitle,
    );
  }

  const changedSurvivors: Array<{ filePath: string; markdown: string }> = [];
  const topicUpdates: Array<{ relations: TopicRelation[]; topicId: string }> = [];
  const files = await listMarkdownFiles(knowledgeRoot);
  for (const filePath of files) {
    if (isReservedFile(filePath) || deleted.has(filePath)) continue;
    const target = await resolveKnowledgePath({ knowledgeRoot, relativePath: filePath });
    if (!target) throw new Error("document_deletion_unsafe_knowledge_path");
    const markdown = await readFile(target, "utf8");
    const parsed = parseOkfMarkdown(markdown);
    const relations = getFrontmatterRelations(parsed.frontmatter);
    const kept = relations.filter(
      (relation) => !deleted.has(resolveRelationPath(filePath, relation.target)),
    );
    if (kept.length === relations.length) continue;
    const updated = replaceRelationsBlock(markdown, kept, manifest.requestedAt);
    await writeFile(target, updated, "utf8");
    changedSurvivors.push({ filePath, markdown: updated });
    const topic = await db.topicRecord.findFirst({
      select: { id: true },
      where: {
        exportedFilePath: filePath,
        knowledgeBundleId: manifest.knowledgeBundleId,
      },
    });
    if (topic) topicUpdates.push({ relations: kept, topicId: topic.id });
  }
  for (const update of topicUpdates) {
    await db.topicRecord.updateMany({
      data: { relations: update.relations as unknown as Prisma.InputJsonValue },
      where: { id: update.topicId },
    });
  }
  return {
    bundleName: bundle.name,
    changedSurvivors,
    deletedFiles,
    knowledgeRoot,
  };
}

export function citationsReferenceDocument(
  value: Prisma.JsonValue,
  documentId: string,
  exportedFilePaths: string[],
) {
  if (!Array.isArray(value)) return false;
  const deletedFiles = new Set(exportedFilePaths.map(normalizeBundlePath));
  return value.some((citation) => {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) return false;
    const entry = citation as Record<string, Prisma.JsonValue>;
    return (
      entry.documentId === documentId ||
      (typeof entry.okfFilePath === "string" &&
        deletedFiles.has(normalizeBundlePath(entry.okfFilePath)))
    );
  });
}

export function replaceRelationsBlock(
  markdown: string,
  relations: TopicRelation[],
  changedAt: string,
) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new Error("document_deletion_invalid_okf_frontmatter");
  const lines = (match[1] ?? "").split(/\r?\n/);
  const filtered: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trim() !== "relations:") {
      filtered.push(lines[index]!);
      continue;
    }
    while (index + 1 < lines.length && /^\s{2,}-/.test(lines[index + 1]!)) {
      index += 1;
      while (index + 1 < lines.length && /^\s{4,}\w/.test(lines[index + 1]!)) index += 1;
    }
  }
  const updatedDate = changedAt.slice(0, 10);
  const updatedLines = filtered.map((line) =>
    /^updated:/.test(line) ? `updated: ${updatedDate}` : line,
  );
  if (relations.length > 0) updatedLines.push(...formatRelations(relations));
  return markdown.replace(match[0], `---\n${updatedLines.join("\n")}\n---`);
}

function formatRelations(relations: TopicRelation[]) {
  return [
    "relations:",
    ...relations.flatMap((relation) => [
      `  - relation: ${JSON.stringify(relation.relation)}`,
      `    target: ${JSON.stringify(relation.target)}`,
      ...(relation.targetType
        ? [`    target_type: ${JSON.stringify(relation.targetType)}`]
        : []),
      `    reason: ${JSON.stringify(relation.reason)}`,
    ]),
  ];
}

async function appendDeletionLog(input: {
  chatAnswers: number;
  conceptFiles: number;
  documentTitle: string;
  knowledgeRoot: string;
  objects: number;
  ragChunks: number;
  timestamp: string;
  topics: number;
}) {
  const logPath = path.join(input.knowledgeRoot, "log.md");
  const entry = `- ${input.timestamp} - permanent-document-deletion - ${input.documentTitle} - objects: ${input.objects} - topics: ${input.topics} - concept_files: ${input.conceptFiles} - rag_chunks: ${input.ragChunks} - chat_answers: ${input.chatAnswers}`;
  const existing = await readFile(logPath, "utf8").catch((error) => {
    if (isMissingPathError(error)) return "# Change Log\n";
    throw error;
  });
  if (existing.split(/\r?\n/).includes(entry)) return;
  await writeFile(logPath, `${existing.trimEnd()}\n\n${entry}\n`, "utf8");
}

async function removeLinesReferencingFiles(filePath: string, deleted: Set<string>) {
  const existing = await readFile(filePath, "utf8").catch((error) => {
    if (isMissingPathError(error)) return null;
    throw error;
  });
  if (existing === null) return;
  const filtered = existing
    .split(/\r?\n/)
    .filter((line) => !Array.from(deleted).some((target) => line.includes(target)));
  await writeFile(filePath, `${filtered.join("\n").trimEnd()}\n`, "utf8");
}

async function removeSourceManifestEntry(filePath: string, documentTitle: string) {
  const existing = await readFile(filePath, "utf8").catch((error) => {
    if (isMissingPathError(error)) return null;
    throw error;
  });
  if (existing === null) return;
  const lines = existing.split(/\r?\n/);
  const filtered: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trim() !== `- ${documentTitle}`) {
      filtered.push(lines[index]!);
      continue;
    }
    while (index + 1 < lines.length && lines[index + 1]!.startsWith("  - ")) index += 1;
  }
  await writeFile(filePath, `${filtered.join("\n").trimEnd()}\n`, "utf8");
}

async function resolveExportedFilePaths(input: {
  explicitPaths: string[];
  knowledgeRoot: string;
  topicIds: string[];
}) {
  const paths = new Set(input.explicitPaths.map(normalizeBundlePath));
  const fragments = new Set(input.topicIds.map(topicIdFragment));
  for (const filePath of await listMarkdownFiles(input.knowledgeRoot)) {
    if (Array.from(fragments).some((fragment) => filePath.endsWith(`-${fragment}.md`))) {
      paths.add(filePath);
    }
  }
  return Array.from(paths).sort();
}

async function listMarkdownFiles(root: string) {
  const result: string[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (isMissingPathError(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(normalizeBundlePath(path.relative(root, fullPath)));
      }
    }
  }
  await walk(root);
  return result.sort();
}

function resolveRelationPath(sourceFile: string, target: string) {
  return normalizeBundlePath(path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), target)));
}

function isReservedFile(filePath: string) {
  return ["index.md", "log.md", "source_manifest.md"].includes(filePath);
}

function normalizeBundlePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function topicIdFragment(topicId: string) {
  return createHash("sha256").update(topicId).digest("hex").slice(0, 10);
}

function parseDeletionManifest(value: Prisma.JsonValue): DocumentDeletionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("document_deletion_manifest_invalid");
  }
  const record = value as Record<string, Prisma.JsonValue>;
  const stringFields = [
    "documentId",
    "documentTitle",
    "knowledgeBundleId",
    "requestedAt",
    "workspaceId",
  ] as const;
  if (stringFields.some((key) => typeof record[key] !== "string")) {
    throw new Error("document_deletion_manifest_invalid");
  }
  if (![record.exportedFilePaths, record.objectKeys, record.topicIds].every(isStringArray)) {
    throw new Error("document_deletion_manifest_invalid");
  }
  if (record.survivorFilesChanged !== undefined && !isStringArray(record.survivorFilesChanged)) {
    throw new Error("document_deletion_manifest_invalid");
  }
  return record as unknown as DocumentDeletionManifest;
}

function isStringArray(value: Prisma.JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertDeletionWorkspace(actual: string, expected: string) {
  if (actual !== expected) throw new Error("document_workspace_mismatch");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
