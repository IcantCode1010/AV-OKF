import type { ChatCitation } from "./chat-types.ts";
import { buildOkfTopicViewHref } from "./okf-topic-routing.ts";

export function getChatCitationHref(
  citation: ChatCitation,
  options: { returnTo?: string } = {},
): string | null {
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
    return buildOkfTopicViewHref({
      bundleId: citation.knowledgeBundleId,
      filePath: citation.okfFilePath,
      returnTo: options.returnTo,
    });
  }

  return null;
}
