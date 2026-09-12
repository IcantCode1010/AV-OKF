import type { EvidenceRef } from "./contracts.ts";

export type PublishedGraphDiscovery = {
  nodes: Array<{ id: string; title: string; documentId: string; sourcePageNumbers: number[] }>;
  paths: Array<{ connections: Array<{ sourceTopicId: string; targetTopicId: string; relation: string }> }>;
};
export type ResearchGraphConnection = {
  sourceTopicId: string; targetTopicId: string; sourceTitle: string; targetTitle: string; relation: string;
  sourceEvidenceIds: string[]; targetEvidenceIds: string[];
};

/** Records discovery provenance, not a claim that a passage proves the relationship. */
export function researchGraphProvenance(discoveries: PublishedGraphDiscovery[], evidence: EvidenceRef[]): ResearchGraphConnection[] {
  const result = new Map<string, ResearchGraphConnection>();
  for (const discovery of discoveries) {
    const topics = new Map(discovery.nodes.map((node) => [node.id, node]));
    for (const path of discovery.paths) for (const connection of path.connections) {
      const source = topics.get(connection.sourceTopicId), target = topics.get(connection.targetTopicId);
      if (!source || !target) continue;
      const sourceEvidenceIds = evidence.filter((entry) => entry.documentId === source.documentId && source.sourcePageNumbers.includes(entry.page)).map((entry) => entry.id);
      const targetEvidenceIds = evidence.filter((entry) => entry.documentId === target.documentId && target.sourcePageNumbers.includes(entry.page)).map((entry) => entry.id);
      if (!sourceEvidenceIds.length || !targetEvidenceIds.length) continue;
      const record = { ...connection, sourceTitle: source.title, targetTitle: target.title,
        sourceEvidenceIds: [...new Set(sourceEvidenceIds)], targetEvidenceIds: [...new Set(targetEvidenceIds)] };
      result.set(JSON.stringify([connection.sourceTopicId, connection.targetTopicId, connection.relation]), record);
    }
  }
  return [...result.values()];
}
