import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { fingerprint } from "../topic-builder-core.ts";
import type { KnowledgeScope } from "./contracts.ts";
export async function resolveKnowledgeScope(
  context: AuthWorkspaceContext,
  selection: { collectionIds?: string[]; documentIds?: string[] } = {},
): Promise<KnowledgeScope> {
  const db = getPrisma();
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId: context.workspaceId, userId: context.userId },
  });
  if (!member) throw Error("knowledge_access_denied");
  const collections = await db.knowledgeBundle.findMany({
    where: {
      workspaceId: context.workspaceId,
      status: "active",
      ...(selection.collectionIds
        ? { id: { in: selection.collectionIds } }
        : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (
    selection.collectionIds &&
    collections.length !== new Set(selection.collectionIds).size
  )
    throw Error("knowledge_scope_unavailable");
  const docs = await db.document.findMany({
    where: {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...(selection.documentIds
        ? {
            id: { in: selection.documentIds },
            OR: [
              { knowledgeBundleId: null },
              { knowledgeBundleId: { in: collections.map((c) => c.id) } },
            ],
          }
        : { knowledgeBundleId: { in: collections.map((c) => c.id) } }),
    },
    select: {
      id: true,
      contentSha256: true,
      revision: true,
      effectivity: true,
      sourceAuthority: true,
      sourceClassification: true,
      pages: true,
      ragIndexVersion: true,
    },
    orderBy: { id: "asc" },
  });
  if (
    selection.documentIds &&
    docs.length !== new Set(selection.documentIds).size
  )
    throw Error("knowledge_source_unavailable");
  return {
    workspaceId: context.workspaceId,
    userId: context.userId,
    collectionIds: collections.map((c) => c.id),
    documentIds: docs.map((d) => d.id),
    fingerprint: fingerprint(docs),
  };
}
export async function validateKnowledgeScope(scope: KnowledgeScope) {
  const current = await resolveKnowledgeScope(
    { workspaceId: scope.workspaceId, userId: scope.userId, role: "member" },
    { collectionIds: scope.collectionIds, documentIds: scope.documentIds },
  );
  if (current.fingerprint !== scope.fingerprint)
    throw Error("knowledge_sources_changed");
}
