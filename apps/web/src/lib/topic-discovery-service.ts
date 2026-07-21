import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider } from "./llm-providers.ts";
import { getPrisma } from "./prisma.ts";
import {
  createSdkTopicDiscoveryProvider,
  discoverDocumentTopics,
  TopicDiscoveryError,
  TOPIC_CONTINUATION_RESOLVER_VERSION,
  type TopicDiscoveryAuditEntry,
  type TopicDiscoveryProvider,
  estimateTokens,
} from "./topic-discovery.ts";
import type { TopicDiscoveryJobPayload } from "./topic-discovery-queue.ts";

export async function runTopicDiscoveryJob(
  payload: TopicDiscoveryJobPayload,
  options: {
    getApiKey?: typeof getWorkspaceLlmApiKeyForEnrichment;
    provider?: TopicDiscoveryProvider;
  } = {},
) {
  const db = getPrisma();
  const job = await db.topicDiscoveryJob.findFirst({
    where: {
      documentId: payload.documentId,
      id: payload.topicDiscoveryJobId,
      workspaceId: payload.workspaceId,
    },
  });
  if (!job) throw new Error("topic_discovery_job_not_found");

  const document = await db.document.findFirst({
    include: { extractedPages: { orderBy: { pageNumber: "asc" } } },
    where: { deletedAt: null, id: payload.documentId, workspaceId: payload.workspaceId },
  });
  if (!document) throw new Error("document_not_found");
  if (!document.knowledgeBundleId) {
    await db.topicDiscoveryJob.update({
      data: { errorCode: "document_unassigned", errorMessage: "Assign the document to an active knowledge bundle before concept discovery.", status: "failed" },
      where: { id: job.id },
    });
    return { status: "failed" as const, topicsCreated: 0 };
  }
  const knowledgeBundleId = document.knowledgeBundleId;
  const bundle = await db.knowledgeBundle.findFirst({ where: { id: knowledgeBundleId, status: "active", workspaceId: payload.workspaceId } });
  if (!bundle) {
    await db.topicDiscoveryJob.update({ data: { errorCode: "knowledge_bundle_unavailable", status: "failed" }, where: { id: job.id } });
    return { status: "failed" as const, topicsCreated: 0 };
  }
  if (document.extractedPages.length === 0) throw new Error("topic_discovery_requires_extracted_pages");

  const getApiKey = options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment;
  const key = options.provider ? null : await getApiKey(payload.workspaceId);
  if (!options.provider && !key) {
    await db.topicDiscoveryJob.update({
      data: {
        errorCode: "topic_discovery_requires_api_key",
        errorMessage: "Configure an LLM provider key, then retry topic discovery.",
        status: "awaiting_provider",
      },
      where: { id: job.id },
    });
    return { status: "awaiting_provider" as const, topicsCreated: 0 };
  }

  const provider = options.provider ?? createSdkTopicDiscoveryProvider({
    apiKey: key!.apiKey,
    model: getLlmProvider(key!.provider).model,
    provider: key!.provider,
  });
  const estimatedInputTokens = estimateTokens(
    document.extractedPages.map((page) => page.text).join("\n"),
  );

  await db.topicDiscoveryJob.update({
    data: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      estimatedInputTokens,
      model: provider.model,
      provider: provider.provider,
      startedAt: new Date(),
      status: "analyzing",
    },
    where: { id: job.id },
  });

  try {
    const result = await discoverDocumentTopics({
      documentTitle: document.title,
      onWindowComplete: async (completed, total) => {
        await db.topicDiscoveryJob.update({
          data: {
            completedWindows: completed,
            status: completed === total ? "consolidating" : "analyzing",
            totalWindows: total,
          },
          where: { id: job.id },
        });
      },
      pages: document.extractedPages.map((page) => ({
        charCount: page.charCount,
        imageCount: page.imageCount,
        pageNumber: page.pageNumber,
        tables: [],
        text: page.text,
      })),
      provider,
    });
    const preserved = await db.topicRecord.findMany({
      select: { sourcePageNumbers: true },
      where: {
        documentId: document.id,
        reviewStatus: { in: ["approved", "rejected"] },
        workspaceId: payload.workspaceId,
      },
    });
    const topics = result.topics.filter((candidate) =>
      !preserved.some((existing) => pagesOverlap(existing.sourcePageNumbers, candidate.pageNumbers)),
    );

    await db.$transaction(async (tx) => {
      await tx.topicRecord.deleteMany({
        where: {
          documentId: document.id,
          reviewStatus: { in: ["needs_review", "needs_cleanup"] },
          workspaceId: payload.workspaceId,
        },
      });
      await tx.topicRecord.createMany({
        data: topics.map((topic) => ({
          confidence: topic.confidence,
          discoveryMetadata: {
            continuationAmbiguities: topic.continuationAmbiguities,
            continuationEvidence: topic.continuationEvidence,
            continuationResolverVersion: TOPIC_CONTINUATION_RESOLVER_VERSION,
            evidenceHeadings: topic.evidenceHeadings,
            jobId: job.id,
            model: provider.model,
            provider: provider.provider,
            rationale: topic.rationale,
            version: "llm-section-v2",
          },
          documentId: document.id,
          knowledgeBundleId,
          originalSummary: topic.summary,
          originalTitle: topic.title,
          pageEnd: Math.max(...topic.pageNumbers),
          pageStart: Math.min(...topic.pageNumbers),
          reviewStatus: topic.confidence === "low" ? "needs_cleanup" : "needs_review",
          sourcePageNumbers: topic.pageNumbers,
          summary: topic.summary,
          title: topic.title,
          topicType: topic.topicType,
          workspaceId: payload.workspaceId,
        })),
      });
      await tx.topicDiscoveryAudit.createMany({
        data: result.audits.map((audit) => auditData(job.id, provider, audit)),
      });
      await tx.topicDiscoveryJob.update({
        data: {
          completedAt: new Date(),
          completedWindows: result.totalWindows,
          estimatedInputTokens: result.estimatedInputTokens,
          status: "completed",
          totalWindows: result.totalWindows,
        },
        where: { id: job.id },
      });
      await tx.activityEvent.create({
        data: {
          documentId: document.id,
          documentTitle: document.title,
          label: `LLM topic discovery completed (${topics.length} drafts)`,
          status: "needs_review",
          timestamp: "Just now",
          workspaceId: payload.workspaceId,
        },
      });
    });
    return { status: "completed" as const, topicsCreated: topics.length };
  } catch (error) {
    const audits = error instanceof TopicDiscoveryError ? error.audits : [];
    await db.$transaction(async (tx) => {
      if (audits.length > 0) {
        await tx.topicDiscoveryAudit.createMany({
          data: audits.map((audit) => auditData(job.id, provider, audit)),
        });
      }
      await tx.topicDiscoveryJob.update({
        data: {
          errorCode: error instanceof Error ? error.message : "topic_discovery_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          status: "failed",
        },
        where: { id: job.id },
      });
    });
    throw error;
  }
}

function auditData(jobId: string, provider: TopicDiscoveryProvider, audit: TopicDiscoveryAuditEntry) {
  return {
    errorMessage: audit.errorMessage,
    jobId,
    model: provider.model,
    promptSent: audit.promptSent,
    provider: provider.provider,
    rawResponse: audit.rawResponse,
    stage: audit.stage,
    succeeded: audit.succeeded,
    windowOrdinal: audit.windowOrdinal,
  };
}

function pagesOverlap(left: number[], right: number[]) {
  const values = new Set(left);
  return right.some((page) => values.has(page));
}
