import type { Prisma } from "@prisma/client";

import type { ExtractedPageRecord } from "./document-vault.ts";
import { getPrisma } from "./prisma.ts";
import {
  resolveExplicitTopicContinuations,
  TOPIC_CONTINUATION_RESOLVER_VERSION,
  type ContinuationAmbiguity,
  type DiscoveredTopic,
  type TopicContinuationEvidence,
} from "./topic-discovery.ts";
import type { TopicContinuationReconciliationPayload } from "./topic-continuation-reconciliation-queue.ts";

export type ReconciliationTopic = DiscoveredTopic & {
  bulkApprovalRunId: string | null;
  discoveryMetadata: Record<string, unknown>;
  enrichmentStatus: string;
  id: string;
  proposedSourcePageNumbers: number[];
  reviewStatus: string;
};

export type TopicContinuationReconciliationUpdate = {
  continuationAmbiguities: ContinuationAmbiguity[];
  continuationEvidence: TopicContinuationEvidence[];
  discoveryMetadata: Record<string, unknown>;
  enrichmentStatus: string;
  id: string;
  invalidatedEnrichment: boolean;
  pageEnd: number;
  pageStart: number;
  promotedPageNumbers: number[];
  proposedSourcePageNumbers: number[];
  sourcePageNumbers: number[];
};

export function buildTopicContinuationReconciliation(input: {
  pages: ExtractedPageRecord[];
  topics: ReconciliationTopic[];
}): TopicContinuationReconciliationUpdate[] {
  const result = resolveExplicitTopicContinuations({ pages: input.pages, topics: input.topics });
  return result.topics.flatMap((resolved, index) => {
    const original = input.topics[index]!;
    if (!isMutableTopic(original)) return [];
    const promotedPageNumbers = resolved.pageNumbers.filter(
      (pageNumber) => !original.pageNumbers.includes(pageNumber),
    );
    const proposed = new Set(original.proposedSourcePageNumbers);
    const invalidatedEnrichment = original.enrichmentStatus === "completed" &&
      promotedPageNumbers.some((pageNumber) => !proposed.has(pageNumber));
    const sourcePageNumbers = uniqueSortedNumbers(resolved.pageNumbers);
    const proposedSourcePageNumbers = original.proposedSourcePageNumbers.filter(
      (pageNumber) => !sourcePageNumbers.includes(pageNumber),
    );
    const continuationEvidence = mergeBoundaryRecords(
      readBoundaryRecords<TopicContinuationEvidence>(original.discoveryMetadata.continuationEvidence),
      resolved.continuationEvidence,
    );
    const continuationAmbiguities = mergeBoundaryRecords(
      readBoundaryRecords<ContinuationAmbiguity>(original.discoveryMetadata.continuationAmbiguities),
      resolved.continuationAmbiguities,
    );
    return [{
      continuationAmbiguities,
      continuationEvidence,
      discoveryMetadata: {
        ...original.discoveryMetadata,
        continuationAmbiguities,
        continuationEvidence,
        continuationResolverVersion: TOPIC_CONTINUATION_RESOLVER_VERSION,
      },
      enrichmentStatus: invalidatedEnrichment ? "none" : original.enrichmentStatus,
      id: original.id,
      invalidatedEnrichment,
      pageEnd: Math.max(...sourcePageNumbers),
      pageStart: Math.min(...sourcePageNumbers),
      promotedPageNumbers,
      proposedSourcePageNumbers,
      sourcePageNumbers,
    }];
  });
}

export async function enqueuePendingTopicContinuationReconciliations(
  enqueue: (payload: TopicContinuationReconciliationPayload) => Promise<void>,
) {
  const documents = await getPrisma().document.findMany({
    select: {
      id: true,
      topicRecords: {
        select: { discoveryMetadata: true },
        where: {
          bulkApprovalRunId: null,
          reviewStatus: { in: ["needs_review", "needs_cleanup"] },
        },
      },
      workspaceId: true,
    },
    where: {
      deletedAt: null,
      topicRecords: {
        some: {
          bulkApprovalRunId: null,
          reviewStatus: { in: ["needs_review", "needs_cleanup"] },
        },
      },
    },
  });
  const pending = documents.filter((document) => document.topicRecords.some((topic) =>
    readMetadata(topic.discoveryMetadata).continuationResolverVersion !==
      TOPIC_CONTINUATION_RESOLVER_VERSION
  ));
  for (const document of pending) {
    await enqueue({ documentId: document.id, workspaceId: document.workspaceId });
  }
  return pending.length;
}

export async function runTopicContinuationReconciliation(
  payload: TopicContinuationReconciliationPayload,
) {
  const db = getPrisma();
  return db.$transaction(async (tx) => {
    const document = await tx.document.findFirst({
      select: {
        extractedPages: { orderBy: { pageNumber: "asc" } },
        id: true,
        title: true,
        topicRecords: {
          orderBy: [{ pageStart: "asc" }, { id: "asc" }],
          where: { reviewStatus: { not: "rejected" } },
        },
        workspaceId: true,
      },
      where: {
        deletedAt: null,
        id: payload.documentId,
        workspaceId: payload.workspaceId,
      },
    });
    if (!document) return { changedTopics: 0, invalidatedTopics: 0, status: "skipped" as const };

    const updates = buildTopicContinuationReconciliation({
      pages: document.extractedPages.map((page) => ({
        charCount: page.charCount,
        imageCount: page.imageCount,
        pageNumber: page.pageNumber,
        tables: [],
        text: page.text,
      })),
      topics: document.topicRecords.map((topic) => {
        const metadata = readMetadata(topic.discoveryMetadata);
        return {
          bulkApprovalRunId: topic.bulkApprovalRunId,
          confidence: normalizeConfidence(topic.confidence),
          discoveryMetadata: metadata,
          enrichmentStatus: topic.enrichmentStatus,
          evidenceHeadings: readStringArray(metadata.evidenceHeadings),
          id: topic.id,
          pageNumbers: topic.sourcePageNumbers,
          proposedSourcePageNumbers: topic.proposedSourcePageNumbers,
          rationale: typeof metadata.rationale === "string" ? metadata.rationale : "",
          reviewStatus: topic.reviewStatus,
          summary: topic.summary,
          title: topic.title,
          topicType: topic.topicType,
        };
      }),
    });
    let changedTopics = 0;
    let invalidatedTopics = 0;
    for (const update of updates) {
      const changed = update.promotedPageNumbers.length > 0;
      await tx.topicRecord.update({
        data: {
          discoveryMetadata: update.discoveryMetadata as unknown as Prisma.InputJsonValue,
          enrichmentStatus: update.enrichmentStatus,
          pageEnd: update.pageEnd,
          pageStart: update.pageStart,
          proposedSourcePageNumbers: update.proposedSourcePageNumbers,
          sourcePageNumbers: update.sourcePageNumbers,
        },
        where: { id: update.id },
      });
      if (changed) changedTopics += 1;
      if (update.invalidatedEnrichment) invalidatedTopics += 1;
    }
    if (changedTopics > 0) {
      await tx.activityEvent.create({
        data: {
          documentId: document.id,
          documentTitle: document.title,
          label: `Reconciled explicit continuation pages for ${changedTopics} ${changedTopics === 1 ? "topic" : "topics"}`,
          status: "needs_review",
          timestamp: "Just now",
          workspaceId: document.workspaceId,
        },
      });
    }
    return { changedTopics, invalidatedTopics, status: "completed" as const };
  });
}

function isMutableTopic(topic: ReconciliationTopic) {
  return (topic.reviewStatus === "needs_review" || topic.reviewStatus === "needs_cleanup") &&
    topic.bulkApprovalRunId === null &&
    topic.discoveryMetadata.continuationResolverVersion !== TOPIC_CONTINUATION_RESOLVER_VERSION;
}

function readMetadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readBoundaryRecords<RecordType extends TopicContinuationEvidence>(value: unknown): RecordType[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RecordType => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<TopicContinuationEvidence>;
    return Number.isInteger(record.fromPage) && Number.isInteger(record.toPage) &&
      typeof record.forwardMarker === "string" && typeof record.backwardMarker === "string";
  });
}

function mergeBoundaryRecords<RecordType extends TopicContinuationEvidence>(
  existing: RecordType[],
  next: RecordType[],
) {
  const records = new Map(existing.map((record) => [boundaryKey(record), record]));
  for (const record of next) records.set(boundaryKey(record), record);
  return [...records.values()].sort((left, right) => left.fromPage - right.fromPage || left.toPage - right.toPage);
}

function boundaryKey(value: TopicContinuationEvidence) {
  return `${value.fromPage}:${value.toPage}`;
}

function uniqueSortedNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalizeConfidence(value: string): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "low";
}
