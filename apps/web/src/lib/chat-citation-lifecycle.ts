import { access } from "node:fs/promises";

import { getPrisma } from "./prisma.ts";
import { getOkfConceptLifecycleByFile } from "./okf-lifecycle.ts";
import { resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
import type { ChatCitation } from "./chat-types.ts";

type CitationLifecycleDependencies = {
  getActiveDocumentIds(input: {
    documentIds: string[];
    workspaceId: string;
  }): Promise<Set<string>>;
  getLifecycles(input: {
    filePaths: string[];
    knowledgeBundleId: string;
    workspaceId: string;
  }): ReturnType<typeof getOkfConceptLifecycleByFile>;
  okfFileExists(input: {
    filePath: string;
    knowledgeBundleId: string;
    workspaceId: string;
  }): Promise<boolean>;
};

export async function annotateChatCitationLifecycle(input: {
  citations: ChatCitation[];
  knowledgeBundleId: string;
  workspaceId: string;
}, dependencies: CitationLifecycleDependencies = defaultDependencies): Promise<ChatCitation[]> {
  if (input.citations.length === 0) return [];

  try {
    const documentIds = Array.from(new Set(
      input.citations
        .filter((citation) => citation.sourceType === "rag")
        .map((citation) => citation.documentId)
        .filter((id): id is string => Boolean(id)),
    ));
    const activeDocumentIds = await dependencies.getActiveDocumentIds({
      documentIds,
      workspaceId: input.workspaceId,
    });
    const okfPaths = Array.from(new Set(
      input.citations
        .filter((citation) => citation.sourceType === "okf")
        .map((citation) => citation.okfFilePath)
        .filter((filePath): filePath is string => Boolean(filePath)),
    ));
    const lifecycles = await dependencies.getLifecycles({
      filePaths: okfPaths,
      knowledgeBundleId: input.knowledgeBundleId,
      workspaceId: input.workspaceId,
    });

    return Promise.all(input.citations.map(async (citation) => {
      if (citation.sourceType === "rag") {
        if (citation.documentId && !activeDocumentIds.has(citation.documentId)) {
          return { ...citation, lifecycleNotice: "This source is no longer available." };
        }
        return citation;
      }

      const withBundle = {
        ...citation,
        knowledgeBundleId: citation.knowledgeBundleId ?? input.knowledgeBundleId,
      };
      if (!citation.okfFilePath) return withBundle;
      const lifecycle = lifecycles.get(citation.okfFilePath);
      if (lifecycle?.status === "retracted") {
        return {
          ...withBundle,
          lifecycleNotice: "This source was retracted after this answer was generated.",
        };
      }
      if (lifecycle?.status === "archived") {
        return {
          ...withBundle,
          lifecycleNotice: "This source is now archived and may no longer reflect current approved knowledge.",
        };
      }
      if (lifecycle?.status === "deleted") {
        return { ...withBundle, lifecycleNotice: "This source is no longer available." };
      }

      if (!(await dependencies.okfFileExists({
        filePath: citation.okfFilePath,
        knowledgeBundleId: input.knowledgeBundleId,
        workspaceId: input.workspaceId,
      }))) {
        return { ...withBundle, lifecycleNotice: "This source is no longer available." };
      }
      return withBundle;
    }));
  } catch (error) {
    console.error("chat_citation_lifecycle_lookup_failed", error);
    return input.citations.map((citation) => ({
      ...citation,
      lifecycleNotice: citation.documentId || citation.okfFilePath
        ? "This source link is temporarily unavailable."
        : citation.lifecycleNotice,
    }));
  }
}

const defaultDependencies: CitationLifecycleDependencies = {
  async getActiveDocumentIds(input) {
    if (input.documentIds.length === 0) return new Set();
    const records = await getPrisma().document.findMany({
      select: { id: true },
      where: {
        deletedAt: null,
        id: { in: input.documentIds },
        workspaceId: input.workspaceId,
      },
    });
    return new Set(records.map((document) => document.id));
  },
  getLifecycles: getOkfConceptLifecycleByFile,
  async okfFileExists(input) {
    const knowledgeRoot = resolveKnowledgeBundleRoot({
      bundleId: input.knowledgeBundleId,
      workspaceId: input.workspaceId,
    });
    const fullPath = await resolveKnowledgePath({
      knowledgeRoot,
      relativePath: input.filePath,
    });
    return Boolean(fullPath && await fileExists(fullPath));
  },
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
