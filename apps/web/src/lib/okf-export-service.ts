import type { Document, TopicRecord } from "./document-vault.ts";
export { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import {
  resolveOkfCoverage,
  syncOkfConceptCoverage,
  type OkfCoverageRepository,
} from "./okf-coverage.ts";
import { exportTopicToKnowledge } from "./okf-export.ts";
import { isProductionBackend } from "./production-document-service.ts";

type ExportApprovedTopicInput = {
  coverageRepository?: OkfCoverageRepository;
  document: Document;
  exportedAt?: Date;
  knowledgeRoot?: string;
  knowledgeVersion?: string;
  topicId: string;
  topics: TopicRecord[];
};

export async function exportApprovedTopicForDocument(
  input: ExportApprovedTopicInput,
): Promise<{ content: string; filename: string }> {
  const topic = input.topics.find((candidate) => candidate.id === input.topicId);

  if (!topic || topic.documentId !== input.document.id) {
    throw new Error("topic_not_found");
  }

  // Local JSON-vault exports have no RAG chunks to link against; only the
  // production Postgres backend populates coverage.
  const coverage =
    isProductionBackend() && input.document.workspaceId
      ? await resolveOkfCoverage({
          documentId: input.document.id,
          repository: input.coverageRepository,
          sourcePageNumbers: topic.sourcePageNumbers,
          workspaceId: input.document.workspaceId,
        })
      : null;

  const exported = await exportTopicToKnowledge({
    document: input.document,
    exportedAt: input.exportedAt,
    knowledgeRoot: input.knowledgeRoot ?? getDefaultKnowledgeRoot(),
    knowledgeVersion: input.knowledgeVersion ?? getKnowledgeVersion(),
    topic: coverage
      ? {
          ...topic,
          coverageType: coverage.coverageType,
          coveredRagChunkIds: coverage.chunkIds,
        }
      : topic,
  });

  if (coverage && input.document.workspaceId) {
    await syncOkfConceptCoverage({
      chunkIds: coverage.chunkIds,
      coverageType: coverage.coverageType,
      okfConceptId: topic.id,
      repository: input.coverageRepository,
      workspaceId: input.document.workspaceId,
    });
  }

  return exported;
}

function getKnowledgeVersion() {
  return process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0";
}
