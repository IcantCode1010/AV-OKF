import type { Document, TopicRecord } from "./document-vault.ts";
export { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { exportTopicToKnowledge } from "./okf-export.ts";

type ExportApprovedTopicInput = {
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

  return exportTopicToKnowledge({
    document: input.document,
    exportedAt: input.exportedAt,
    knowledgeRoot: input.knowledgeRoot ?? getDefaultKnowledgeRoot(),
    knowledgeVersion: input.knowledgeVersion ?? getKnowledgeVersion(),
    topic,
  });
}

function getKnowledgeVersion() {
  return process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0";
}
