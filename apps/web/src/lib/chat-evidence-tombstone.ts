import type { Prisma } from "@prisma/client";

export const DELETED_KNOWLEDGE_SOURCE_CHAT_ANSWER =
  "This answer was removed because its supporting knowledge source was permanently deleted.";

export function chatMessageReferencesKnowledgeBundle(input: {
  bundleId: string;
  citations: Prisma.JsonValue;
  knowledgeBundleIds: string[];
}): boolean {
  if (!Array.isArray(input.citations) || input.citations.length === 0) {
    return false;
  }

  let hasLegacyCitation = false;
  for (const citation of input.citations) {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
      continue;
    }
    const record = citation as Record<string, Prisma.JsonValue>;
    if (record.knowledgeBundleId === input.bundleId) {
      return true;
    }
    if (typeof record.knowledgeBundleId !== "string") {
      hasLegacyCitation = true;
    }
  }

  return (
    hasLegacyCitation &&
    input.knowledgeBundleIds.length === 1 &&
    input.knowledgeBundleIds[0] === input.bundleId
  );
}
