import type { ChatRetrievalResult } from "../chat-retrieval.ts";
import type { ResearchResult } from "./contracts.ts";

/** A completed research run replaces discovery snippets, even when it found nothing. */
export function projectResearchChatEvidence(base: ChatRetrievalResult, research: ResearchResult): ChatRetrievalResult {
  const inspected = [...new Map(research.evidence.map((entry) => [entry.id, entry])).values()];
  const citations = inspected.map((entry, index) => ({
    index: index + 1,
    researchEvidenceId: entry.id,
    documentId: entry.documentId,
    documentTitle: entry.documentTitle,
    knowledgeBundleId: entry.collectionId ?? undefined,
    pageStart: entry.page,
    pageEnd: entry.page,
    sourceType: "rag" as const,
    text: entry.quote.slice(0, 240),
  }));
  return {
    ...base,
    citations,
    evidence: inspected.map((entry, index) => ({ ...citations[index], text: entry.quote })),
    approvedOkfAvailable: false,
    ragUsedForDiscoveryOnly: inspected.length > 0,
    okfEvidenceMode: undefined,
    okfMatchMode: undefined,
    crossBundleConflict: undefined,
    retrievalError: false,
    retrievalToolsCalled: [...new Set([...base.retrievalToolsCalled, "agentic_graph_research"])],
    sourcesRead: [...new Set(inspected.map((entry) => `${entry.documentTitle} (p. ${entry.page})`))],
  };
}
