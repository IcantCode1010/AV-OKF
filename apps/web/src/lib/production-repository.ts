import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { generateTopicCandidates } from "./topic-records.ts";
import { getPrisma } from "./prisma.ts";
import type {
  ActivityEvent,
  CustomProperty,
  Document,
  DocumentStatus,
  ExtractionLog,
  ExtractedPageRecord,
  ExtractionError,
  ExtractionStatus,
  ApprovedContentSource,
  SourceType,
  TopicConfidence,
  TopicEnrichmentStatus,
  TopicRecord,
  TopicReviewStatus,
} from "./document-vault.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  normalizeTopicRelations,
  type TopicRelation,
} from "./okf-relation-types.ts";

type UploadRecordInput = {
  context: AuthWorkspaceContext;
  description: string;
  documentId: string;
  objectKey: string;
  originalFilename: string;
  owner: string;
  sizeBytes: number;
  sourceType: SourceType;
  tags: string[];
  title: string;
};

type UpdateMetadataInput = {
  aircraftFamily: string | null;
  ata: string | null;
  context: AuthWorkspaceContext;
  customProperties: CustomProperty[];
  description: string;
  documentId: string;
  effectivity: string | null;
  manualType: string | null;
  owner: string;
  revision: string | null;
  sourceAuthority: string | null;
  sourceType: SourceType;
  status: DocumentStatus;
  tags: string[];
  title: string;
};

export type ProductionDocumentRepository = ReturnType<
  typeof createPostgresDocumentRepository
>;

type DbCustomProperty = {
  key: string;
  value: string;
};

type DbDocumentObject = {
  kind: string;
  objectKey: string;
};

type DbExtractedPage = {
  charCount: number;
  imageCount: number;
  pageNumber: number;
  tables: unknown;
  text: string;
};

type DbExtractionJob = {
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  status: string;
};

type DbExtractionLog = {
  id: string;
  level: string;
  message: string;
  timestamp: Date;
};

type DbDocumentRecord = {
  aircraftFamily: string | null;
  ata: string | null;
  customProperties?: DbCustomProperty[];
  description: string;
  effectivity: string | null;
  extractedPages?: DbExtractedPage[];
  extractionJobs?: DbExtractionJob[];
  extractionLogs?: DbExtractionLog[];
  fileType: string;
  id: string;
  manualType: string | null;
  mimeType: string;
  objects?: DbDocumentObject[];
  originalFilename: string | null;
  owner: string;
  pages: number;
  revision: string | null;
  size: string;
  sizeBytes: number;
  sourceType: string;
  sourceAuthority: string | null;
  status: string;
  tags: string[];
  title: string;
  updatedLabel: string;
  workspaceId: string;
};

type DbActivityEvent = {
  documentTitle: string;
  id: string;
  label: string;
  status: string;
  timestamp: string;
};

type DbTopicRecord = {
  approvedContentSource: string | null;
  confidence: string;
  createdAt: Date;
  documentId: string;
  editedAt: Date | null;
  editedBy: string | null;
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  enrichmentAudits?: DbTopicEnrichmentAudit[];
  enrichmentStatus: string;
  id: string;
  originalSummary: string;
  originalTitle: string;
  pageEnd: number;
  pageStart: number;
  relations: Prisma.JsonValue;
  reviewStatus: string;
  sourcePageNumbers: number[];
  summary: string;
  title: string;
  topicType: string;
  updatedAt: Date;
};

type DbTopicEnrichmentAudit = {
  createdAt: Date;
  errorMessage: string | null;
  id: string;
  model: string;
  promptSent: string;
  provider: string;
  rawResponse: string;
  requestedBy: string;
  succeeded: boolean;
  topicId: string;
};

type QueuedExtractionJob = {
  documentId: string;
  id: string;
  workspaceId: string;
};

export function createPostgresDocumentRepository(prisma = getPrisma()) {
  const db = prisma;

  async function getDocumentForWorkspace(documentId: string, workspaceId: string) {
    const record = await db.document.findFirst({
      include: {
        customProperties: true,
        extractedPages: { orderBy: { pageNumber: "asc" } },
        extractionJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
        extractionLogs: { orderBy: { timestamp: "asc" } },
        objects: { orderBy: { createdAt: "asc" } },
      },
      where: { id: documentId, workspaceId },
    });

    if (!record) {
      throw new Error("document_not_found");
    }

    return record;
  }

  async function createActivity(input: {
    context: AuthWorkspaceContext;
    documentId?: string;
    documentTitle: string;
    label: string;
    status: DocumentStatus;
  }) {
    await db.activityEvent.create({
      data: {
        documentId: input.documentId,
        documentTitle: input.documentTitle,
        label: input.label,
        status: input.status,
        timestamp: "Just now",
        workspaceId: input.context.workspaceId,
      },
    });
  }

  return {
    async completeExtractionJob(input: {
      documentId: string;
      extractionJobId: string;
      pageRecords: ExtractedPageRecord[];
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const now = new Date();
        await tx.extractedPage.deleteMany({
          where: { documentId: input.documentId, workspaceId: input.workspaceId },
        });
        await tx.extractedPage.createMany({
          data: input.pageRecords.map((page) => ({
            charCount: page.charCount,
            documentId: input.documentId,
            imageCount: page.imageCount,
            pageNumber: page.pageNumber,
            tables: page.tables,
            text: page.text,
            workspaceId: input.workspaceId,
          })),
        });
        await tx.extractionJob.update({
          data: {
            completedAt: now,
            errorCode: null,
            errorMessage: null,
            status: "completed",
          },
          where: { id: input.extractionJobId },
        });
        const document = await tx.document.update({
          data: {
            pages: input.pageRecords.length,
            status: "ready",
            updatedLabel: formatTimestamp(now),
          },
          where: { id: input.documentId },
        });
        await tx.extractionLog.create({
          data: {
            documentId: input.documentId,
            jobId: input.extractionJobId,
            level: "info",
            message: `Extraction completed with ${input.pageRecords.length} page records.`,
            workspaceId: input.workspaceId,
          },
        });
        await tx.activityEvent.create({
          data: {
            documentId: input.documentId,
            documentTitle: document.title,
            label: "Extraction completed",
            status: "ready",
            timestamp: "Just now",
            workspaceId: input.workspaceId,
          },
        });
      });
    },
    async createExtractionJob(input: {
      context: AuthWorkspaceContext;
      documentId: string;
    }) {
      const document = await getDocumentForWorkspace(
        input.documentId,
        input.context.workspaceId,
      );
      const job = await db.extractionJob.create({
        data: {
          documentId: input.documentId,
          status: "queued",
          workspaceId: input.context.workspaceId,
        },
      });
      await createActivity({
        context: input.context,
        documentId: input.documentId,
        documentTitle: document.title,
        label: "Extraction queued",
        status: "processing",
      });
      return job as { id: string; documentId: string; workspaceId: string };
    },
    async createRagIndexJobAfterExtraction(input: {
      documentId: string;
      extractionJobId: string;
      workspaceId: string;
    }) {
      const { createRagRepository } = await import("./rag-repository.ts");
      return createRagRepository().createIndexJob(input);
    },
    async createUploadedDocumentRecord(input: UploadRecordInput) {
      const timestamp = formatTimestamp(new Date());
      const title =
        input.title.trim() || input.originalFilename.replace(/\.pdf$/i, "");

      const document = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.document.create({
          data: {
            description: input.description.trim(),
            fileType: "PDF",
            id: input.documentId,
            mimeType: "application/pdf",
            originalFilename: input.originalFilename,
            owner: input.owner.trim() || "Unassigned",
            size: formatBytes(input.sizeBytes),
            sizeBytes: input.sizeBytes,
            sourceType: input.sourceType,
            status: "processing",
            tags: input.tags,
            title,
            updatedLabel: timestamp,
            workspaceId: input.context.workspaceId,
            customProperties: { create: [] },
            objects: {
              create: {
                bucket: process.env.S3_BUCKET ?? "av-okf",
                contentType: "application/pdf",
                kind: "original_pdf",
                objectKey: input.objectKey,
                sizeBytes: input.sizeBytes,
                workspaceId: input.context.workspaceId,
              },
            },
          },
          include: {
            customProperties: true,
            extractedPages: true,
            extractionJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
            extractionLogs: true,
            objects: true,
          },
        });
        await tx.activityEvent.create({
          data: {
            documentId: created.id,
            documentTitle: title,
            label: "PDF uploaded",
            status: "processing",
            timestamp: "Just now",
            workspaceId: input.context.workspaceId,
          },
        });
        return created;
      });

      return mapDocument(document);
    },
    async failExtractionJob(input: {
      documentId: string;
      error: ExtractionError;
      extractionJobId: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const now = new Date();
        const document = await tx.document.update({
          data: {
            status: "blocked",
            updatedLabel: formatTimestamp(now),
          },
          where: { id: input.documentId },
        });
        await tx.extractionJob.update({
          data: {
            completedAt: now,
            errorCode: input.error.code,
            errorMessage: input.error.message,
            status: "failed",
          },
          where: { id: input.extractionJobId },
        });
        await tx.extractionLog.create({
          data: {
            documentId: input.documentId,
            jobId: input.extractionJobId,
            level: "error",
            message: input.error.message,
            workspaceId: input.workspaceId,
          },
        });
        await tx.activityEvent.create({
          data: {
            documentId: input.documentId,
            documentTitle: document.title,
            label: "Extraction failed",
            status: "blocked",
            timestamp: "Just now",
            workspaceId: input.workspaceId,
          },
        });
      });
    },
    async generateTopicRecords(input: {
      context: AuthWorkspaceContext;
      documentId: string;
    }) {
      const document = await getDocumentForWorkspace(
        input.documentId,
        input.context.workspaceId,
      );
      const mapped = mapDocument(document);

      if (mapped.extraction.status !== "completed") {
        throw new Error("document_extraction_not_completed");
      }

      const preservedTopics = await db.topicRecord.findMany({
        where: {
          documentId: input.documentId,
          reviewStatus: { in: ["approved", "rejected"] },
          workspaceId: input.context.workspaceId,
        },
      });
      const candidates = generateTopicCandidates(
        input.documentId,
        mapped.extraction.pageRecords,
      );
      const newTopics = candidates.filter(
        (candidate) =>
          !preservedTopics.some((topic: DbTopicRecord) =>
            pagesOverlap(topic.sourcePageNumbers, candidate.sourcePageNumbers),
          ),
      );

      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.topicRecord.deleteMany({
          where: {
            documentId: input.documentId,
            reviewStatus: { in: ["needs_review", "needs_cleanup"] },
            workspaceId: input.context.workspaceId,
          },
        });
        await tx.topicRecord.createMany({
          data: newTopics.map((topic) => ({
            approvedContentSource: null,
            confidence: topic.confidence,
            documentId: input.documentId,
            enrichedSummary: null,
            enrichedTitle: null,
            enrichmentStatus: "none",
            originalSummary: topic.summary,
            originalTitle: topic.title,
            pageEnd: topic.pageEnd,
            pageStart: topic.pageStart,
            reviewStatus: "needs_review",
            relations: [],
            sourcePageNumbers: topic.sourcePageNumbers,
            summary: topic.summary,
            title: topic.title,
            topicType: topic.topicType,
            workspaceId: input.context.workspaceId,
          })),
        });
        await tx.activityEvent.create({
          data: {
            documentId: input.documentId,
            documentTitle: mapped.title,
            label: "Topic records generated",
            status: mapped.status,
            timestamp: "Just now",
            workspaceId: input.context.workspaceId,
          },
        });
      });

      const topics = await db.topicRecord.findMany({
        include: {
          enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        orderBy: [{ pageStart: "asc" }, { createdAt: "asc" }],
        where: {
          documentId: input.documentId,
          workspaceId: input.context.workspaceId,
        },
      });
      return topics.map(mapTopicRecord);
    },
    async getActivityEvents(context: AuthWorkspaceContext) {
      const events = await db.activityEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        where: { workspaceId: context.workspaceId },
      });
      return events.map(mapActivityEvent);
    },
    async getDocumentById(input: {
      context: AuthWorkspaceContext;
      documentId: string;
    }) {
      const document = await getDocumentForWorkspace(
        input.documentId,
        input.context.workspaceId,
      );
      return mapDocument(document);
    },
    async getDocumentWorkspaceId(documentId: string) {
      const document = await db.document.findUnique({
        select: { workspaceId: true },
        where: { id: documentId },
      });
      return document?.workspaceId;
    },
    async getDocumentMetrics(context: AuthWorkspaceContext) {
      const documents = await db.document.findMany({
        where: { workspaceId: context.workspaceId },
      });
      return {
        processing: documents.filter(
          (document: { status: string }) => document.status === "processing",
        ).length,
        ready: documents.filter(
          (document: { status: string }) =>
            document.status === "ready" || document.status === "indexed",
        ).length,
        review: documents.filter(
          (document: { status: string }) => document.status === "needs_review",
        ).length,
        total: documents.length,
      };
    },
    async getDocuments(context: AuthWorkspaceContext) {
      const documents = await db.document.findMany({
        include: {
          customProperties: true,
          extractedPages: { orderBy: { pageNumber: "asc" } },
          extractionJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
          extractionLogs: { orderBy: { timestamp: "asc" } },
          objects: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { updatedAt: "desc" },
        where: { workspaceId: context.workspaceId },
      });
      return documents.map(mapDocument);
    },
    async getPrimaryDocumentObject(input: {
      documentId: string;
      workspaceId: string;
    }) {
      const object = await db.documentObject.findFirst({
        where: {
          documentId: input.documentId,
          kind: "original_pdf",
          workspaceId: input.workspaceId,
        },
      });

      if (!object) {
        throw new Error("document_has_no_stored_pdf");
      }

      return { objectKey: object.objectKey };
    },
    async getQueuedExtractionJobs(limit = 100) {
      return db.extractionJob.findMany({
        orderBy: { queuedAt: "asc" },
        take: limit,
        where: { status: { in: ["queued", "running"] } },
      }) as Promise<QueuedExtractionJob[]>;
    },
    async getTopicRecordsByDocumentId(input: {
      context: AuthWorkspaceContext;
      documentId: string;
    }) {
      const topics = await db.topicRecord.findMany({
        include: {
          enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        orderBy: [{ pageStart: "asc" }, { createdAt: "asc" }],
        where: {
          documentId: input.documentId,
          workspaceId: input.context.workspaceId,
        },
      });
      return topics.map(mapTopicRecord);
    },
    async getTopicEnrichmentInput(input: {
      context: AuthWorkspaceContext;
      topicId: string;
    }) {
      const topic = await db.topicRecord.findFirst({
        include: {
          enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!topic) {
        throw new Error("topic_not_found");
      }

      const sourcePages = await db.extractedPage.findMany({
        orderBy: { pageNumber: "asc" },
        where: {
          documentId: topic.documentId,
          pageNumber: { in: topic.sourcePageNumbers },
          workspaceId: input.context.workspaceId,
        },
      });

      return {
        sourcePages: sourcePages.map(mapExtractedPage),
        topic: mapTopicRecord(topic),
      };
    },
    async markTopicEnrichmentPending(input: {
      context: AuthWorkspaceContext;
      topicId: string;
    }) {
      const existingTopic = await db.topicRecord.findFirst({
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!existingTopic) {
        throw new Error("topic_not_found");
      }

      if (normalizeTopicReviewStatus(existingTopic.reviewStatus) === "approved") {
        throw new Error("topic_enrichment_requires_unapproved_topic");
      }

      const topic = await db.topicRecord.update({
        data: { enrichmentStatus: "pending" },
        include: {
          enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        where: { id: input.topicId },
      });
      return mapTopicRecord(topic);
    },
    async completeTopicEnrichment(input: {
      context: AuthWorkspaceContext;
      enrichedSummary: string;
      enrichedTitle: string;
      model: string;
      promptSent: string;
      provider: string;
      rawResponse: string;
      requestedBy: string;
      topicId: string;
    }) {
      await assertTopicInWorkspace(db, input.topicId, input.context.workspaceId);
      const topic = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.topicEnrichmentAudit.create({
          data: {
            errorMessage: null,
            model: input.model,
            promptSent: input.promptSent,
            provider: input.provider,
            rawResponse: input.rawResponse,
            requestedBy: input.requestedBy,
            succeeded: true,
            topicId: input.topicId,
          },
        });
        return tx.topicRecord.update({
          data: {
            enrichedSummary: input.enrichedSummary,
            enrichedTitle: input.enrichedTitle,
            enrichmentStatus: "completed",
          },
          include: {
            enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
          },
          where: { id: input.topicId },
        });
      });
      return mapTopicRecord(topic);
    },
    async failTopicEnrichment(input: {
      context: AuthWorkspaceContext;
      errorMessage: string;
      model: string;
      promptSent: string;
      provider: string;
      rawResponse: string;
      requestedBy: string;
      topicId: string;
    }) {
      await assertTopicInWorkspace(db, input.topicId, input.context.workspaceId);
      const topic = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.topicEnrichmentAudit.create({
          data: {
            errorMessage: input.errorMessage,
            model: input.model,
            promptSent: input.promptSent,
            provider: input.provider,
            rawResponse: input.rawResponse,
            requestedBy: input.requestedBy,
            succeeded: false,
            topicId: input.topicId,
          },
        });
        return tx.topicRecord.update({
          data: { enrichmentStatus: "failed" },
          include: {
            enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
          },
          where: { id: input.topicId },
        });
      });
      return mapTopicRecord(topic);
    },
    async approveTopicContent(input: {
      approvedContentSource: ApprovedContentSource;
      context: AuthWorkspaceContext;
      topicId: string;
    }) {
      const existingTopic = await db.topicRecord.findFirst({
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!existingTopic) {
        throw new Error("topic_not_found");
      }

      if (normalizeTopicReviewStatus(existingTopic.reviewStatus) === "approved") {
        throw new Error("topic_already_approved");
      }

      if (input.approvedContentSource === "enriched") {
        if (!existingTopic.enrichedTitle || !existingTopic.enrichedSummary) {
          throw new Error("topic_enrichment_required_for_approval");
        }
      }

      const topic = await db.topicRecord.update({
        data: {
          approvedContentSource: input.approvedContentSource,
          reviewStatus: "approved",
          ...(input.approvedContentSource === "enriched"
            ? {
                summary: existingTopic.enrichedSummary ?? existingTopic.summary,
                title: existingTopic.enrichedTitle ?? existingTopic.title,
              }
            : {}),
        },
        include: {
          enrichmentAudits: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        where: { id: input.topicId },
      });
      return mapTopicRecord(topic);
    },
    async startExtractionJob(input: {
      documentId: string;
      extractionJobId: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const now = new Date();
        const document = await tx.document.update({
          data: {
            status: "processing",
            updatedLabel: formatTimestamp(now),
          },
          where: { id: input.documentId },
        });
        await tx.extractionJob.update({
          data: {
            attempts: { increment: 1 },
            startedAt: now,
            status: "running",
          },
          where: { id: input.extractionJobId },
        });
        await tx.extractionLog.create({
          data: {
            documentId: input.documentId,
            jobId: input.extractionJobId,
            level: "info",
            message: "Extraction started.",
            workspaceId: input.workspaceId,
          },
        });
        await tx.activityEvent.create({
          data: {
            documentId: input.documentId,
            documentTitle: document.title,
            label: "Extraction started",
            status: "processing",
            timestamp: "Just now",
            workspaceId: input.workspaceId,
          },
        });
      });
    },
    async updateDocumentMetadata(input: UpdateMetadataInput) {
      await getDocumentForWorkspace(input.documentId, input.context.workspaceId);
      await db.documentCustomProperty.deleteMany({
        where: { documentId: input.documentId },
      });
      const document = await db.document.update({
        data: {
          aircraftFamily: normalizeOptionalMetadata(input.aircraftFamily),
          ata: normalizeOptionalMetadata(input.ata),
          customProperties: {
            create: input.customProperties,
          },
          description: input.description.trim(),
          effectivity: normalizeOptionalMetadata(input.effectivity),
          manualType: normalizeOptionalMetadata(input.manualType),
          owner: input.owner.trim() || "Unassigned",
          revision: normalizeOptionalMetadata(input.revision),
          sourceAuthority: normalizeOptionalMetadata(input.sourceAuthority),
          sourceType: input.sourceType,
          status: input.status,
          tags: input.tags,
          title: input.title.trim(),
          updatedLabel: formatTimestamp(new Date()),
        },
        include: {
          customProperties: true,
          extractedPages: { orderBy: { pageNumber: "asc" } },
          extractionJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
          extractionLogs: { orderBy: { timestamp: "asc" } },
          objects: { orderBy: { createdAt: "asc" } },
        },
        where: { id: input.documentId },
      });
      await createActivity({
        context: input.context,
        documentId: input.documentId,
        documentTitle: document.title,
        label: "Metadata updated",
        status: normalizeDocumentStatus(document.status),
      });
      return mapDocument(document);
    },
    async updateTopicReviewStatus(input: {
      context: AuthWorkspaceContext;
      reviewStatus: TopicReviewStatus;
      topicId: string;
    }) {
      const existingTopic = await db.topicRecord.findFirst({
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!existingTopic) {
        throw new Error("topic_not_found");
      }

      const topic = await db.topicRecord.update({
        data: { reviewStatus: input.reviewStatus },
        where: { id: input.topicId },
      });
      return mapTopicRecord(topic);
    },
    async updateTopicRelations(input: {
      context: AuthWorkspaceContext;
      relations: TopicRelation[];
      topicId: string;
    }) {
      const existingTopic = await db.topicRecord.findFirst({
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!existingTopic) {
        throw new Error("topic_not_found");
      }

      if (normalizeTopicReviewStatus(existingTopic.reviewStatus) !== "approved") {
        throw new Error("topic_relations_require_approved_topic");
      }

      const topic = await db.topicRecord.update({
        data: { relations: input.relations as unknown as Prisma.InputJsonValue },
        where: { id: input.topicId },
      });
      return mapTopicRecord(topic);
    },
    async updateTopicContent(input: {
      context: AuthWorkspaceContext;
      editedBy: string;
      summary?: string;
      title?: string;
      topicId: string;
    }) {
      const existingTopic = await db.topicRecord.findFirst({
        where: {
          id: input.topicId,
          workspaceId: input.context.workspaceId,
        },
      });

      if (!existingTopic) {
        throw new Error("topic_not_found");
      }

      if (normalizeTopicReviewStatus(existingTopic.reviewStatus) === "approved") {
        throw new Error("topic_content_edit_requires_unapproved_topic");
      }

      const nextTitle =
        input.title === undefined ? existingTopic.title : input.title.trim();
      const nextSummary =
        input.summary === undefined ? existingTopic.summary : input.summary.trim();

      if (nextTitle.length === 0) {
        throw new Error("topic_title_required");
      }

      const changed =
        nextTitle !== existingTopic.title || nextSummary !== existingTopic.summary;
      const topic = await db.topicRecord.update({
        data: {
          ...(changed
            ? {
                editedAt: new Date(),
                editedBy: input.editedBy,
              }
            : {}),
          summary: nextSummary,
          title: nextTitle,
        },
        where: { id: input.topicId },
      });

      return mapTopicRecord(topic);
    },
  };
}

function mapDocument(record: DbDocumentRecord): Document {
  const latestJob = record.extractionJobs?.[0];
  const pageRecords: ExtractedPageRecord[] = (record.extractedPages ?? []).map(
    (page) => ({
      charCount: page.charCount,
      imageCount: page.imageCount,
      pageNumber: page.pageNumber,
      tables: normalizeExtractedTables(page.tables),
      text: page.text,
    }),
  );
  const logs = (record.extractionLogs ?? []).map((log) => ({
    id: log.id,
    level: normalizeLogLevel(log.level),
    message: log.message,
    timestamp: formatTimestamp(log.timestamp),
  }));
  const primaryObject = record.objects?.find(
    (object) => object.kind === "original_pdf",
  );

  return {
    aircraftFamily: record.aircraftFamily,
    ata: record.ata,
    customProperties: (record.customProperties ?? []).map((property) => ({
      key: property.key,
      value: property.value,
    })),
    description: record.description,
    effectivity: record.effectivity,
    extraction: {
      completedAt: latestJob?.completedAt ? formatTimestamp(latestJob.completedAt) : null,
      error: latestJob?.errorCode
        ? {
            code: latestJob.errorCode,
            message: latestJob.errorMessage ?? latestJob.errorCode,
          }
        : null,
      logs,
      pageRecords,
      startedAt: latestJob?.startedAt ? formatTimestamp(latestJob.startedAt) : null,
      status: normalizeExtractionStatus(latestJob?.status),
    },
    fileType: record.fileType,
    id: record.id,
    workspaceId: record.workspaceId,
    manualType: record.manualType,
    mimeType: record.mimeType,
    originalFilename: record.originalFilename,
    owner: record.owner,
    pages: record.pages,
    revision: record.revision,
    size: record.size,
    sizeBytes: record.sizeBytes,
    sourceType: normalizeSourceType(record.sourceType),
    sourceAuthority: record.sourceAuthority,
    status: normalizeDocumentStatus(record.status),
    storageKey: primaryObject?.objectKey ?? null,
    tags: record.tags ?? [],
    title: record.title,
    updatedAt: record.updatedLabel,
  };
}

function mapExtractedPage(page: DbExtractedPage): ExtractedPageRecord {
  return {
    charCount: page.charCount,
    imageCount: page.imageCount,
    pageNumber: page.pageNumber,
    tables: normalizeExtractedTables(page.tables),
    text: page.text,
  };
}

function normalizeOptionalMetadata(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function mapActivityEvent(record: DbActivityEvent): ActivityEvent {
  return {
    documentTitle: record.documentTitle,
    id: record.id,
    label: record.label,
    status: normalizeDocumentStatus(record.status),
    timestamp: record.timestamp,
  };
}

function mapTopicRecord(record: DbTopicRecord): TopicRecord {
  const audits = record.enrichmentAudits ?? [];
  const latestAudit = audits[0];
  const latestSuccess = audits.find((audit) => audit.succeeded);

  return {
    approvedContentSource: normalizeApprovedContentSource(
      record.approvedContentSource,
    ),
    confidence: normalizeTopicConfidence(record.confidence),
    createdAt: formatTimestamp(record.createdAt),
    documentId: record.documentId,
    editedAt: record.editedAt ? formatTimestamp(record.editedAt) : null,
    editedBy: record.editedBy,
    enrichedAt: latestSuccess ? formatTimestamp(latestSuccess.createdAt) : null,
    enrichedSummary: record.enrichedSummary,
    enrichedTitle: record.enrichedTitle,
    enrichmentErrorMessage:
      normalizeTopicEnrichmentStatus(record.enrichmentStatus) === "failed"
        ? latestAudit?.errorMessage ?? null
        : null,
    enrichmentModel: latestSuccess?.model ?? null,
    enrichmentStatus: normalizeTopicEnrichmentStatus(record.enrichmentStatus),
    id: record.id,
    originalSummary: record.originalSummary ?? record.summary,
    originalTitle: record.originalTitle ?? record.title,
    pageEnd: record.pageEnd,
    pageStart: record.pageStart,
    relations: normalizeTopicRelations(record.relations),
    reviewStatus: normalizeTopicReviewStatus(record.reviewStatus),
    sourcePageNumbers: record.sourcePageNumbers,
    summary: record.summary,
    title: record.title,
    topicType: record.topicType,
    updatedAt: formatTimestamp(record.updatedAt),
  };
}

async function assertTopicInWorkspace(
  db: ReturnType<typeof getPrisma>,
  topicId: string,
  workspaceId: string,
) {
  const topic = await db.topicRecord.findFirst({
    select: { id: true },
    where: { id: topicId, workspaceId },
  });

  if (!topic) {
    throw new Error("topic_not_found");
  }
}

function pagesOverlap(left: number[], right: number[]) {
  const rightPages = new Set(right);
  return left.some((pageNumber) => rightPages.has(pageNumber));
}

function normalizeDocumentStatus(value: string): DocumentStatus {
  if (
    value === "ready" ||
    value === "processing" ||
    value === "needs_review" ||
    value === "indexed" ||
    value === "blocked"
  ) {
    return value;
  }

  return "needs_review";
}

function normalizeExtractionStatus(value: string | undefined): ExtractionStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  return "queued";
}

function normalizeLogLevel(value: string): ExtractionLog["level"] {
  if (value === "warning" || value === "error") {
    return value;
  }

  return "info";
}

function normalizeSourceType(value: string): SourceType {
  return value === "aviation" ? "aviation" : "general";
}

function normalizeTopicConfidence(value: string): TopicConfidence {
  if (value === "medium" || value === "high") {
    return value;
  }

  return "low";
}

function normalizeTopicReviewStatus(value: string): TopicReviewStatus {
  if (
    value === "needs_cleanup" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }

  return "needs_review";
}

function normalizeTopicEnrichmentStatus(value: string): TopicEnrichmentStatus {
  if (
    value === "pending" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  return "none";
}

function normalizeApprovedContentSource(
  value: string | null,
): ApprovedContentSource | null {
  return value === "raw" || value === "enriched" ? value : null;
}

function normalizeExtractedTables(value: unknown): ExtractedPageRecord["tables"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isExtractedTable);
}

function isExtractedTable(
  value: unknown,
): value is ExtractedPageRecord["tables"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { index?: unknown; rows?: unknown };
  return (
    typeof candidate.index === "number" &&
    Array.isArray(candidate.rows) &&
    candidate.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.every((cell) => typeof cell === "string"),
    )
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function createProductionDocumentId() {
  return `doc_${randomUUID()}`;
}
