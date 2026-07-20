import type { ChatCitation } from "./chat-types.ts";

export function getChatCitationHref(citation: ChatCitation): string | null {
  if (citation.lifecycleNotice) return null;

  if (citation.sourceType === "rag" && citation.documentId) {
    const page = Math.max(1, citation.pageStart);
    return `/api/documents/${encodeURIComponent(citation.documentId)}/file#page=${page}`;
  }

  if (
    citation.sourceType === "okf" &&
    citation.knowledgeBundleId &&
    citation.okfFilePath
  ) {
    return `/knowledge/${encodeURIComponent(citation.knowledgeBundleId)}?file=${encodeURIComponent(citation.okfFilePath)}`;
  }

  return null;
}
