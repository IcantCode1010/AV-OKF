import {
  MAX_UPLOAD_BYTES,
  assertPdfMagicBytes,
  assertPdfUpload,
  customPropertiesToText,
  parseCustomProperties,
  parseTags,
  type ActivityEvent,
  type Document,
  type DocumentMetrics,
  type DocumentStatus,
  type ApprovedContentSource,
  type SourceType,
  type TopicRecord,
  type TopicReviewStatus,
} from "./document-vault.ts";
import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import {
  buildDocumentObjectKey,
  generateDocumentObjectId,
  getObjectStorage,
} from "./production-storage.ts";
import {
  createPostgresDocumentRepository,
  createProductionDocumentId,
  type ProductionDocumentRepository,
} from "./production-repository.ts";
import { getExtractionQueue } from "./production-queue.ts";
import type { TopicRelation } from "./okf-relations.ts";

type UploadMetadata = {
  bytes: Buffer;
  description: string;
  originalFilename: string;
  owner: string;
  sourceType: SourceType;
  tags: string[];
  title: string;
  type: string;
};

type UpdateMetadata = {
  aircraftFamily: string | null;
  ata: string | null;
  description: string;
  effectivity: string | null;
  manualType: string | null;
  owner: string;
  revision: string | null;
  sourceAuthority: string | null;
  sourceType: SourceType;
  status: DocumentStatus;
  tags: string[];
  title: string;
  customProperties: ReturnType<typeof parseCustomProperties>;
};

export type ProductionDocumentService = {
  createUploadedDocument(input: UploadMetadata): Promise<Document>;
  generateTopicRecords(documentId: string): Promise<TopicRecord[]>;
  getActivityEvents(): Promise<ActivityEvent[]>;
  getDocumentById(documentId: string): Promise<Document | undefined>;
  getDocumentWorkspaceId(documentId: string): Promise<string | undefined>;
  getDocumentMetrics(): Promise<DocumentMetrics>;
  getDocuments(): Promise<Document[]>;
  getRecentDocuments(limit?: number): Promise<Document[]>;
  getTopicRecordsByDocumentId(documentId: string): Promise<TopicRecord[]>;
  requestExtraction(documentId: string): Promise<void>;
  updateDocumentMetadata(
    documentId: string,
    input: UpdateMetadata,
  ): Promise<Document>;
  updateTopicReviewStatus(
    topicId: string,
    reviewStatus: TopicReviewStatus,
  ): Promise<TopicRecord>;
  updateTopicRelations(
    topicId: string,
    relations: TopicRelation[],
  ): Promise<TopicRecord>;
  updateTopicContent(
    topicId: string,
    input: { editedBy: string; summary?: string; title?: string },
  ): Promise<TopicRecord>;
  getTopicEnrichmentInput(
    topicId: string,
  ): ReturnType<ProductionDocumentRepository["getTopicEnrichmentInput"]>;
  markTopicEnrichmentPending(topicId: string): Promise<TopicRecord>;
  completeTopicEnrichment(
    topicId: string,
    input: Parameters<ProductionDocumentRepository["completeTopicEnrichment"]>[0] extends {
      context: infer _Context;
    }
      ? Omit<
          Parameters<ProductionDocumentRepository["completeTopicEnrichment"]>[0],
          "context" | "topicId"
        >
      : never,
  ): Promise<TopicRecord>;
  failTopicEnrichment(
    topicId: string,
    input: Parameters<ProductionDocumentRepository["failTopicEnrichment"]>[0] extends {
      context: infer _Context;
    }
      ? Omit<
          Parameters<ProductionDocumentRepository["failTopicEnrichment"]>[0],
          "context" | "topicId"
        >
      : never,
  ): Promise<TopicRecord>;
  approveTopicContent(
    topicId: string,
    approvedContentSource: ApprovedContentSource,
  ): Promise<TopicRecord>;
};

let cachedService: ProductionDocumentService | null = null;

export {
  MAX_UPLOAD_BYTES,
  customPropertiesToText,
  parseCustomProperties,
  parseTags,
};

export function isProductionBackend(): boolean {
  return process.env.AV_OKF_BACKEND === "production";
}

export function getProductionDocumentService(): ProductionDocumentService {
  if (!cachedService) {
    cachedService = createProductionDocumentService();
  }

  return cachedService;
}

export function createProductionDocumentService(
  repository = createPostgresDocumentRepository(),
  storage = getObjectStorage(),
  queue = getExtractionQueue(),
): ProductionDocumentService {
  return {
    async createUploadedDocument(input: UploadMetadata): Promise<Document> {
      const context = await requireAuthWorkspaceContext();
      assertPdfUpload({
        name: input.originalFilename,
        size: input.bytes.byteLength,
        type: input.type,
      });
      assertPdfMagicBytes(input.bytes);

      const documentId = createProductionDocumentId();
      const objectKey = buildDocumentObjectKey({
        documentId,
        objectId: generateDocumentObjectId(),
        workspaceId: context.workspaceId,
      });

      await storage.putObject({
        body: input.bytes,
        contentType: "application/pdf",
        key: objectKey,
      });

      return repository.createUploadedDocumentRecord({
        context,
        description: input.description,
        documentId,
        objectKey,
        originalFilename: input.originalFilename,
        owner: input.owner,
        sizeBytes: input.bytes.byteLength,
        sourceType: input.sourceType,
        tags: input.tags,
        title: input.title,
      });
    },
    async generateTopicRecords(documentId: string): Promise<TopicRecord[]> {
      return repository.generateTopicRecords({
        context: await requireAuthWorkspaceContext(),
        documentId,
      });
    },
    async getActivityEvents(): Promise<ActivityEvent[]> {
      return repository.getActivityEvents(await requireAuthWorkspaceContext());
    },
    async getDocumentById(documentId: string): Promise<Document | undefined> {
      try {
        return await repository.getDocumentById({
          context: await requireAuthWorkspaceContext(),
          documentId,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "document_not_found"
        ) {
          return undefined;
        }

        throw error;
      }
    },
    async getDocumentWorkspaceId(
      documentId: string,
    ): Promise<string | undefined> {
      return repository.getDocumentWorkspaceId(documentId);
    },
    async getDocumentMetrics(): Promise<DocumentMetrics> {
      return repository.getDocumentMetrics(await requireAuthWorkspaceContext());
    },
    async getDocuments(): Promise<Document[]> {
      return repository.getDocuments(await requireAuthWorkspaceContext());
    },
    async getRecentDocuments(limit = 4): Promise<Document[]> {
      return (await this.getDocuments()).slice(0, limit);
    },
    async getTopicRecordsByDocumentId(
      documentId: string,
    ): Promise<TopicRecord[]> {
      return repository.getTopicRecordsByDocumentId({
        context: await requireAuthWorkspaceContext(),
        documentId,
      });
    },
    async requestExtraction(documentId: string): Promise<void> {
      const context = await requireAuthWorkspaceContext();
      const job = await repository.createExtractionJob({ context, documentId });

      try {
        await queue.enqueueExtractionJob({
          documentId: job.documentId,
          extractionJobId: job.id,
          workspaceId: job.workspaceId,
        });
      } catch (error) {
        console.error("Extraction enqueue failed; queued job remains in Postgres.", error);
      }
    },
    async updateDocumentMetadata(
      documentId: string,
      input: UpdateMetadata,
    ): Promise<Document> {
      return repository.updateDocumentMetadata({
        aircraftFamily: input.aircraftFamily,
        ata: input.ata,
        context: await requireAuthWorkspaceContext(),
        customProperties: input.customProperties,
        description: input.description,
        documentId,
        effectivity: input.effectivity,
        manualType: input.manualType,
        owner: input.owner,
        revision: input.revision,
        sourceAuthority: input.sourceAuthority,
        sourceType: input.sourceType,
        status: input.status,
        tags: input.tags,
        title: input.title,
      });
    },
    async updateTopicReviewStatus(
      topicId: string,
      reviewStatus: TopicReviewStatus,
    ): Promise<TopicRecord> {
      return repository.updateTopicReviewStatus({
        context: await requireAuthWorkspaceContext(),
        reviewStatus,
        topicId,
      });
    },
    async updateTopicRelations(
      topicId: string,
      relations: TopicRelation[],
    ): Promise<TopicRecord> {
      return repository.updateTopicRelations({
        context: await requireAuthWorkspaceContext(),
        relations,
        topicId,
      });
    },
    async updateTopicContent(
      topicId: string,
      input: { editedBy: string; summary?: string; title?: string },
    ): Promise<TopicRecord> {
      return repository.updateTopicContent({
        context: await requireAuthWorkspaceContext(),
        editedBy: input.editedBy,
        summary: input.summary,
        title: input.title,
        topicId,
      });
    },
    async getTopicEnrichmentInput(topicId: string) {
      return repository.getTopicEnrichmentInput({
        context: await requireAuthWorkspaceContext(),
        topicId,
      });
    },
    async markTopicEnrichmentPending(topicId: string): Promise<TopicRecord> {
      return repository.markTopicEnrichmentPending({
        context: await requireAuthWorkspaceContext(),
        topicId,
      });
    },
    async completeTopicEnrichment(topicId, input): Promise<TopicRecord> {
      return repository.completeTopicEnrichment({
        context: await requireAuthWorkspaceContext(),
        topicId,
        ...input,
      });
    },
    async failTopicEnrichment(topicId, input): Promise<TopicRecord> {
      return repository.failTopicEnrichment({
        context: await requireAuthWorkspaceContext(),
        topicId,
        ...input,
      });
    },
    async approveTopicContent(
      topicId: string,
      approvedContentSource: ApprovedContentSource,
    ): Promise<TopicRecord> {
      return repository.approveTopicContent({
        approvedContentSource,
        context: await requireAuthWorkspaceContext(),
        topicId,
      });
    },
  };
}
