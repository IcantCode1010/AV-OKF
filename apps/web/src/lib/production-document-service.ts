import {
  MAX_UPLOAD_BYTES,
  assertPdfMagicBytes,
  assertPdfUpload,
  customPropertiesToText,
  parseCustomProperties,
  parseTags,
  type DocumentStatus,
  type SourceType,
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
} from "./production-repository.ts";
import { getExtractionQueue } from "./production-queue.ts";

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
  description: string;
  owner: string;
  sourceType: SourceType;
  status: DocumentStatus;
  tags: string[];
  title: string;
  customProperties: ReturnType<typeof parseCustomProperties>;
};

let cachedService: ReturnType<typeof createProductionDocumentService> | null = null;

export {
  MAX_UPLOAD_BYTES,
  customPropertiesToText,
  parseCustomProperties,
  parseTags,
};

export function isProductionBackend() {
  return process.env.AV_OKF_BACKEND === "production";
}

export function getProductionDocumentService() {
  if (!cachedService) {
    cachedService = createProductionDocumentService();
  }

  return cachedService;
}

export function createProductionDocumentService(
  repository = createPostgresDocumentRepository(),
  storage = getObjectStorage(),
  queue = getExtractionQueue(),
) {
  return {
    async createUploadedDocument(input: UploadMetadata) {
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
    async generateTopicRecords(documentId: string) {
      return repository.generateTopicRecords({
        context: await requireAuthWorkspaceContext(),
        documentId,
      });
    },
    async getActivityEvents() {
      return repository.getActivityEvents(await requireAuthWorkspaceContext());
    },
    async getDocumentById(documentId: string) {
      return repository.getDocumentById({
        context: await requireAuthWorkspaceContext(),
        documentId,
      });
    },
    async getDocumentMetrics() {
      return repository.getDocumentMetrics(await requireAuthWorkspaceContext());
    },
    async getDocuments() {
      return repository.getDocuments(await requireAuthWorkspaceContext());
    },
    async getRecentDocuments(limit = 4) {
      return (await this.getDocuments()).slice(0, limit);
    },
    async getTopicRecordsByDocumentId(documentId: string) {
      return repository.getTopicRecordsByDocumentId({
        context: await requireAuthWorkspaceContext(),
        documentId,
      });
    },
    async requestExtraction(documentId: string) {
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
    async updateDocumentMetadata(documentId: string, input: UpdateMetadata) {
      return repository.updateDocumentMetadata({
        context: await requireAuthWorkspaceContext(),
        customProperties: input.customProperties,
        description: input.description,
        documentId,
        owner: input.owner,
        sourceType: input.sourceType,
        status: input.status,
        tags: input.tags,
        title: input.title,
      });
    },
    async updateTopicReviewStatus(
      topicId: string,
      reviewStatus: TopicReviewStatus,
    ) {
      return repository.updateTopicReviewStatus({
        context: await requireAuthWorkspaceContext(),
        reviewStatus,
        topicId,
      });
    },
  };
}
