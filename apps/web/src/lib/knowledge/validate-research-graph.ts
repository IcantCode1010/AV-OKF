import type { ResearchGraphConnection } from "./research-graph-provenance.ts";
import type { EvidenceRef } from "./contracts.ts";

export type CurrentGraphTopic = { id: string; title: string; documentId: string; sourcePageNumbers: number[]; exportedFilePath: string | null; knowledgeBundleId: string };

/** Revalidate publication and endpoint provenance before reuse or final answer storage. */
export async function validateResearchGraph(input: {
  connections: ResearchGraphConnection[];
  evidence: EvidenceRef[];
  topics: CurrentGraphTopic[];
  hasPublishedConnection: (source: CurrentGraphTopic, target: CurrentGraphTopic, relation: string) => Promise<boolean>;
}) {
  const topics = new Map(input.topics.map((topic) => [topic.id, topic]));
  const evidence = new Map(input.evidence.map((entry) => [entry.id, entry]));
  for (const connection of input.connections) {
    const source = topics.get(connection.sourceTopicId), target = topics.get(connection.targetTopicId);
    if (!source?.exportedFilePath || !target?.exportedFilePath || source.knowledgeBundleId !== target.knowledgeBundleId ||
      source.title !== connection.sourceTitle || target.title !== connection.targetTitle)
      throw Error("knowledge_graph_changed");
    for (const [topic, ids] of [[source, connection.sourceEvidenceIds], [target, connection.targetEvidenceIds]] as const) {
      if (!ids.length || ids.some((id) => {
        const entry = evidence.get(id);
        return !entry || entry.documentId !== topic.documentId || !topic.sourcePageNumbers.includes(entry.page);
      })) throw Error("knowledge_graph_changed");
    }
    if (!await input.hasPublishedConnection(source, target, connection.relation)) throw Error("knowledge_graph_changed");
  }
}
