import path from "node:path";

import type { Document, TopicRecord } from "./document-vault.ts";
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

export function getDefaultKnowledgeRoot(cwd = process.cwd()): string {
  if (process.env.AV_OKF_KNOWLEDGE_ROOT) {
    return path.resolve(process.env.AV_OKF_KNOWLEDGE_ROOT);
  }

  if (path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps") {
    return path.resolve(cwd, "..", "..", "knowledge");
  }

  return path.resolve(cwd, "knowledge");
}

function getKnowledgeVersion() {
  return process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0";
}
