import type { Document, TopicRecord } from "./document-vault.ts";
export { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import {
  resolveOkfCoverage,
  syncOkfConceptCoverage,
  type OkfCoverageRepository,
} from "./okf-coverage.ts";
import { exportTopicToKnowledge } from "./okf-export.ts";
import { isProductionBackend } from "./production-document-service.ts";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "./knowledge-bundles.ts";
import { getKnowledgeProfileTemplate, getTypeDirectory } from "./knowledge-profile.ts";

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
  if (topic.reviewStatus !== "approved") {
    throw new Error("okf_export_requires_approved_topic");
  }
  if (!input.document.knowledgeBundleId) {
    throw new Error("document_requires_active_knowledge_bundle");
  }
  const knowledgeBundleId = input.document.knowledgeBundleId;

  const workspaceId = input.document.workspaceId ?? "local";
  const bundle = input.knowledgeRoot
    ? { profile: getKnowledgeProfileTemplate("generic") }
    : await getKnowledgeBundleByIdentity({
        bundleId: knowledgeBundleId,
        workspaceId,
      });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const conceptType =
    typeof topic.okfMetadata?.type === "string"
      ? topic.okfMetadata.type
      : "system_topic";
  const directory = getTypeDirectory(bundle.profile, conceptType);

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
    directory,
    document: input.document,
    exportedAt: input.exportedAt,
    knowledgeRoot:
      input.knowledgeRoot ??
      resolveKnowledgeBundleRoot({
        bundleId: knowledgeBundleId,
        workspaceId,
      }),
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
      knowledgeBundleId,
      okfConceptId: topic.id,
      repository: input.coverageRepository,
      workspaceId: input.document.workspaceId,
    });
  }

  if (
    isProductionBackend() &&
    !input.knowledgeRoot &&
    input.document.workspaceId &&
    input.document.knowledgeBundleId
  ) {
    const {
      createOkfConceptEmbeddingRepository,
      queueOkfConceptEmbedding,
    } = await import("./okf-concept-embedding.ts");
    const repository = createOkfConceptEmbeddingRepository();
    if (topic.exportedFilePath && topic.exportedFilePath !== exported.filename) {
      await repository.deleteForFile({
        filePath: topic.exportedFilePath,
        knowledgeBundleId: input.document.knowledgeBundleId,
        workspaceId: input.document.workspaceId,
      });
    }
    await queueOkfConceptEmbedding({
      bundleName: "name" in bundle ? bundle.name : "Knowledge Bundle",
      filePath: exported.filename,
      knowledgeBundleId: input.document.knowledgeBundleId,
      markdown: exported.content,
      repository,
      workspaceId: input.document.workspaceId,
    });
  }

  return exported;
}

function getKnowledgeVersion() {
  return process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0";
}
