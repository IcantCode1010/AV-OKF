import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthWorkspaceContext } from "../src/lib/auth-workspace.ts";
import {
  assertOkfArticleRepairAcknowledgement,
  buildOkfArticleRepairReport,
  getRepairedEnrichedBody,
  type OkfArticleRepairCandidate,
} from "../src/lib/okf-article-repair.ts";
import { readOkfBundleFile } from "../src/lib/okf-bundle.ts";
import { buildOkfSystemTopic } from "../src/lib/okf-export.ts";
import { exportApprovedTopicForDocument } from "../src/lib/okf-export-service.ts";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "../src/lib/knowledge-bundles.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import { createPostgresDocumentRepository } from "../src/lib/production-repository.ts";
import { getTypeDirectory } from "../src/lib/knowledge-profile.ts";

const args = process.argv.slice(2);
const workspaceId = readArg("--workspace");
const bundleId = readArg("--bundle");
const reportPath = readArg("--report");
const acknowledgement = readArg("--acknowledge");
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run");

if (!workspaceId) throw new Error("okf_article_repair_requires_workspace");
if (!bundleId) throw new Error("okf_article_repair_requires_bundle");
if (apply === dryRun) {
  throw new Error("okf_article_repair_requires_exactly_one_mode");
}

const db = getPrisma();
const repository = createPostgresDocumentRepository(db);
const context: AuthWorkspaceContext = {
  role: "admin",
  userId: "okf-article-format-repair",
  workspaceId,
};

try {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId, workspaceId });
  if (!bundle || bundle.status !== "active") {
    throw new Error("okf_article_repair_bundle_not_found");
  }

  const records = await db.topicRecord.findMany({
    orderBy: [{ documentId: "asc" }, { pageStart: "asc" }, { id: "asc" }],
    select: {
      approvalMode: true,
      documentId: true,
      enrichedBody: true,
      exportedFilePath: true,
      id: true,
      relations: true,
      reviewStatus: true,
      sourcePageNumbers: true,
      summary: true,
      title: true,
      updatedAt: true,
    },
    where: {
      exportedFilePath: { not: null },
      knowledgeBundleId: bundleId,
      reviewStatus: "approved",
      workspaceId,
    },
  });
  const knowledgeRoot = resolveKnowledgeBundleRoot({ bundleId, workspaceId });
  const candidates = await Promise.all(records.map(async (record) => {
    const exportedFilePath = record.exportedFilePath!;
    const exportedMarkdown = await readOkfBundleFile(knowledgeRoot, exportedFilePath)
      .then((file) => file.content)
      .catch(() => null);
    return {
      approvalMode: record.approvalMode,
      enrichedBody: record.enrichedBody,
      exportedFilePath,
      exportedMarkdown,
      relations: record.relations,
      reviewStatus: record.reviewStatus,
      sourcePageNumbers: record.sourcePageNumbers,
      summary: record.summary,
      title: record.title,
      topicId: record.id,
    } satisfies OkfArticleRepairCandidate;
  }));
  const report = buildOkfArticleRepairReport({
    bundleId,
    candidates,
    workspaceId,
  });
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    await writeFile(path.resolve(reportPath), reportJson, "utf8");
  }
  process.stdout.write(reportJson);

  if (dryRun) process.exitCode = 0;
  if (apply) {
    assertOkfArticleRepairAcknowledgement(report, acknowledgement);
    const documents = await repository.getDocuments(context);
    const recordByTopicId = new Map(records.map((record) => [record.id, record]));
    const candidateByTopicId = new Map(candidates.map((candidate) => [candidate.topicId, candidate]));

    for (const item of report.items.filter((candidate) => candidate.requiresChange)) {
      const record = recordByTopicId.get(item.topicId);
      const candidate = candidateByTopicId.get(item.topicId);
      if (!record || !candidate) throw new Error("okf_article_repair_topic_not_found");

      const document = documents.find((entry) => entry.id === record.documentId);
      if (!document || document.knowledgeBundleId !== bundleId) {
        throw new Error(`okf_article_repair_document_not_found:${record.documentId}`);
      }
      const currentTopics = await repository.getTopicRecordsByDocumentId({
        context,
        documentId: document.id,
      });
      const currentTopic = currentTopics.find((topic) => topic.id === record.id);
      if (!currentTopic) throw new Error(`okf_article_repair_topic_not_found:${record.id}`);
      const type = typeof currentTopic.okfMetadata.type === "string"
        ? currentTopic.okfMetadata.type
        : "system_topic";
      const expectedFilename = path.posix.join(
        getTypeDirectory(bundle.profile, type),
        buildOkfSystemTopic({
          document,
          knowledgeVersion: process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0",
          topic: currentTopic,
        }).filename,
      );
      if (expectedFilename !== item.exportedFilePath) {
        throw new Error(
          `okf_article_repair_filename_would_change:${item.exportedFilePath}:${expectedFilename}`,
        );
      }

      if (item.storedBody.changed) {
        const updated = await db.topicRecord.updateMany({
          data: { enrichedBody: getRepairedEnrichedBody(candidate) },
          where: {
            enrichedBody: record.enrichedBody,
            id: record.id,
            knowledgeBundleId: bundleId,
            updatedAt: record.updatedAt,
            workspaceId,
          },
        });
        if (updated.count !== 1) {
          throw new Error(`okf_article_repair_stale_topic:${record.id}`);
        }
      }

      const topics = await repository.getTopicRecordsByDocumentId({
        context,
        documentId: document.id,
      });
      const exported = await exportApprovedTopicForDocument({
        document,
        topicId: record.id,
        topics,
      });
      if (exported.filename !== item.exportedFilePath) {
        throw new Error(
          `okf_article_repair_filename_changed:${item.exportedFilePath}:${exported.filename}`,
        );
      }
    }
  }
} finally {
  await db.$disconnect();
}

function readArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
