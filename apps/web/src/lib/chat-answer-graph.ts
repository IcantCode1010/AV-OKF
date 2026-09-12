import type { ChatCitation } from "./chat-types.ts";
import type { GraphEvidenceContext } from "./okf-graph-evidence.ts";

export type ChatAnswerConnection = { sourceCitation: number; targetCitation: number; relation: string; sourceTitle?: string; targetTitle?: string; sourceTopicId?: string; targetTopicId?: string };

/** Only connections whose two endpoints survived answer citation finalization. */
export function buildChatAnswerConnections(evidence: GraphEvidenceContext[], citations: ChatCitation[], research: import("./knowledge/research-graph-provenance.ts").ResearchGraphConnection[] = []): ChatAnswerConnection[] {
  const key = (bundle: string, file: string) => JSON.stringify([bundle, file]);
  const cited = new Map(citations.flatMap((citation) =>
    citation.sourceType === "okf" && citation.knowledgeBundleId && citation.okfFilePath && !citation.lifecycleNotice
      ? [[key(citation.knowledgeBundleId, citation.okfFilePath), citation.index] as const] : []));
  const connections = new Map<string, ChatAnswerConnection>();
  for (const item of evidence) {
    if (!item.knowledgeBundleId) continue;
    for (const edge of item.graphConnections ?? []) {
      if (!edge.sourceFile || !edge.targetFile) continue;
      const sourceCitation = cited.get(key(item.knowledgeBundleId, edge.sourceFile));
      const targetCitation = cited.get(key(item.knowledgeBundleId, edge.targetFile));
      if (sourceCitation === undefined || targetCitation === undefined || sourceCitation === targetCitation) continue;
      const connection = { sourceCitation, targetCitation, relation: edge.relation };
      connections.set(JSON.stringify(connection), connection);
    }
  }
  for (const edge of research) {
    const sources = citations.filter((citation) => !citation.lifecycleNotice && citation.researchEvidenceId && edge.sourceEvidenceIds.includes(citation.researchEvidenceId));
    const targets = citations.filter((citation) => !citation.lifecycleNotice && citation.researchEvidenceId && edge.targetEvidenceIds.includes(citation.researchEvidenceId));
    const source = sources.find((candidate) => targets.some((target) => target.index !== candidate.index)) ?? sources[0];
    const target = source && (targets.find((candidate) => candidate.index !== source.index) ?? targets[0]);
    if (!source || !target) continue;
    const connection = { sourceCitation: source.index, targetCitation: target.index, relation: edge.relation,
      sourceTitle: edge.sourceTitle, targetTitle: edge.targetTitle, sourceTopicId: edge.sourceTopicId, targetTopicId: edge.targetTopicId };
    connections.set(JSON.stringify(connection), connection);
  }
  return [...connections.values()];
}
