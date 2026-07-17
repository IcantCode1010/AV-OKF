import {
  completeExtraction,
  completeTopicEnrichment as completeLocalTopicEnrichment,
  approveTopicContent as approveLocalTopicContent,
  createUploadedDocument as createLocalUploadedDocument,
  customPropertiesToText,
  failExtraction,
  failTopicEnrichment as failLocalTopicEnrichment,
  generateTopicRecords as generateLocalTopicRecords,
  getActivityEvents as getLocalActivityEvents,
  getDocumentById as getLocalDocumentById,
  getDocumentMetrics as getLocalDocumentMetrics,
  getDocumentPdfBytes,
  getTopicEnrichmentInput as getLocalTopicEnrichmentInput,
  getDocuments as getLocalDocuments,
  getRecentDocuments as getLocalRecentDocuments,
  getTopicRecordsByDocumentId as getLocalTopicRecordsByDocumentId,
  MAX_UPLOAD_BYTES,
  assertPdfUpload,
  parseCustomProperties,
  parseTags,
  startExtraction,
  markTopicEnrichmentPending as markLocalTopicEnrichmentPending,
  updateDocumentMetadata as updateLocalDocumentMetadata,
  updateTopicContent as updateLocalTopicContent,
  updateTopicOkfMetadata as updateLocalTopicOkfMetadata,
  updateTopicExportedFilePath as updateLocalTopicExportedFilePath,
  updateTopicRelations as updateLocalTopicRelations,
  updateTopicReviewStatus as updateLocalTopicReviewStatus,
  type ActivityEvent,
  type CustomProperty,
  type Document,
  type DocumentMetrics,
  type DocumentStatus,
  type ExtractedPageRecord,
  type ExtractionError,
  type ExtractionStatus,
  type SourceType,
  type TopicRecord,
  type TopicReviewStatus,
  type ApprovedContentSource,
  type User,
  type Workspace,
} from "./document-vault.ts";
import type { TopicRelation } from "./okf-relation-types.ts";
import { startDetachedExtraction } from "./document-extraction.ts";
import {
  getProductionDocumentService,
  isProductionBackend,
} from "./production-document-service.ts";

export {
  completeExtraction,
  customPropertiesToText,
  failExtraction,
  getDocumentPdfBytes,
  MAX_UPLOAD_BYTES,
  assertPdfUpload,
  parseCustomProperties,
  parseTags,
  startExtraction,
};
export type {
  ActivityEvent,
  CustomProperty,
  Document,
  DocumentMetrics,
  DocumentStatus,
  ExtractedPageRecord,
  ExtractionError,
  ExtractionStatus,
  SourceType,
  TopicRecord,
  TopicReviewStatus,
  ApprovedContentSource,
  User,
  Workspace,
};

export async function createUploadedDocument(
  input: Parameters<typeof createLocalUploadedDocument>[0],
): Promise<Document> {
  if (isProductionBackend()) {
    return getProductionDocumentService().createUploadedDocument(input);
  }

  return createLocalUploadedDocument(input);
}

export async function generateTopicRecords(id: string): Promise<TopicRecord[]> {
  if (isProductionBackend()) {
    return getProductionDocumentService().generateTopicRecords(id);
  }

  return generateLocalTopicRecords(id);
}

export async function getActivityEvents(): Promise<ActivityEvent[]> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getActivityEvents();
  }

  return getLocalActivityEvents();
}

export async function getDocumentById(
  id: string,
): Promise<Document | undefined> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getDocumentById(id);
  }

  return getLocalDocumentById(id);
}

export async function getDocumentWorkspaceId(
  id: string,
): Promise<string | undefined> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getDocumentWorkspaceId(id);
  }

  return (await getLocalDocumentById(id))?.workspaceId;
}

export async function getDocumentMetrics(): Promise<DocumentMetrics> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getDocumentMetrics();
  }

  return getLocalDocumentMetrics();
}

export async function getDocuments(): Promise<Document[]> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getDocuments();
  }

  return getLocalDocuments();
}

export async function getRecentDocuments(limit = 4): Promise<Document[]> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getRecentDocuments(limit);
  }

  return getLocalRecentDocuments(limit);
}

export async function getTopicRecordsByDocumentId(
  id: string,
): Promise<TopicRecord[]> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getTopicRecordsByDocumentId(id);
  }

  return getLocalTopicRecordsByDocumentId(id);
}

export async function requestExtraction(id: string): Promise<void> {
  if (isProductionBackend()) {
    await getProductionDocumentService().requestExtraction(id);
    return;
  }

  startDetachedExtraction(id);
}

export async function updateDocumentMetadata(
  id: string,
  input: Parameters<typeof updateLocalDocumentMetadata>[1],
): Promise<Document> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateDocumentMetadata(id, input);
  }

  return updateLocalDocumentMetadata(id, input);
}

export async function updateTopicReviewStatus(
  topicId: string,
  reviewStatus: TopicReviewStatus,
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateTopicReviewStatus(
      topicId,
      reviewStatus,
    );
  }

  return updateLocalTopicReviewStatus(topicId, reviewStatus);
}

export async function updateTopicRelations(
  topicId: string,
  relations: TopicRelation[],
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateTopicRelations(topicId, relations);
  }

  return updateLocalTopicRelations(topicId, relations);
}

export async function updateTopicExportedFilePath(
  topicId: string,
  exportedFilePath: string,
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateTopicExportedFilePath(
      topicId,
      exportedFilePath,
    );
  }

  return updateLocalTopicExportedFilePath(topicId, exportedFilePath);
}

export async function updateTopicContent(
  topicId: string,
  input: Parameters<typeof updateLocalTopicContent>[1],
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateTopicContent(topicId, input);
  }

  return updateLocalTopicContent(topicId, input);
}

export async function updateTopicOkfMetadata(
  topicId: string,
  okfMetadata: Record<string, unknown>,
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().updateTopicOkfMetadata(topicId, okfMetadata);
  }
  return updateLocalTopicOkfMetadata(topicId, okfMetadata);
}

export async function getTopicEnrichmentInput(
  topicId: string,
): Promise<Awaited<ReturnType<typeof getLocalTopicEnrichmentInput>>> {
  if (isProductionBackend()) {
    return getProductionDocumentService().getTopicEnrichmentInput(topicId);
  }

  return getLocalTopicEnrichmentInput(topicId);
}

export async function markTopicEnrichmentPending(
  topicId: string,
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().markTopicEnrichmentPending(topicId);
  }

  return markLocalTopicEnrichmentPending(topicId);
}

export async function completeTopicEnrichment(
  topicId: string,
  input: Parameters<typeof completeLocalTopicEnrichment>[1],
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().completeTopicEnrichment(topicId, input);
  }

  return completeLocalTopicEnrichment(topicId, input);
}

export async function failTopicEnrichment(
  topicId: string,
  input: Parameters<typeof failLocalTopicEnrichment>[1],
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().failTopicEnrichment(topicId, input);
  }

  return failLocalTopicEnrichment(topicId, input);
}

export async function approveTopicContent(
  topicId: string,
  approvedContentSource: ApprovedContentSource,
): Promise<TopicRecord> {
  if (isProductionBackend()) {
    return getProductionDocumentService().approveTopicContent(
      topicId,
      approvedContentSource,
    );
  }

  return approveLocalTopicContent(topicId, approvedContentSource);
}
