import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { fingerprint, type BuilderResult } from "../topic-builder-core.ts";
import { EDITORIAL_POLICY_VERSION } from "./contracts.ts";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function importBuilderRevision(runId: string) {
  const db = getPrisma();
  const run = await db.topicBuilderRun.findUniqueOrThrow({
    where: { id: runId },
    include: { recipe: true },
  });
  if (!run.result || !["ready", "approved"].includes(run.status)) return;
  const result = run.result as unknown as BuilderResult;
  for (const body of result.articles) {
    const originId = `${run.recipeId}:${body.id}`,
      id = `article-${fingerprint(originId).slice(0, 24)}`,
      revisionId = `revision-${fingerprint([run.id, body.id]).slice(0, 24)}`;
    const approval =
      run.status === "approved"
        ? { by: run.approvedBy, at: run.approvedAt, source: "topic-builder" }
        : undefined;
    await db.$transaction(async (tx) => {
      await tx.knowledgeArticle.upsert({
        where: { id },
        create: {
          id,
          workspaceId: run.workspaceId,
          originKind: "recipe",
          originId,
          collectionId: run.recipe.collectionIds[0] ?? null,
        },
        update: {},
      });
      await tx.knowledgeArticleRevision.upsert({
        where: { id: revisionId },
        create: {
          id: revisionId,
          articleId: id,
          workspaceId: run.workspaceId,
          body: json({ ...body, maxWords: run.recipe.maxWords }),
          evidence: json(
            result.evidence.filter((e) =>
              new Set([
                ...body.evidenceIds,
                ...body.keyPoints.flatMap((p) => p.evidenceIds),
                ...body.details.flatMap((p) => p.evidenceIds),
                ...body.relationships.flatMap((p) => p.evidenceIds),
              ]).has(e.id),
            ),
          ),
          sourceFingerprint: run.fingerprint,
          policyVersion: EDITORIAL_POLICY_VERSION,
          ...(approval ? { approval: json(approval) } : {}),
        },
        update: approval ? { approval: json(approval) } : {},
      });
      if (approval)
        await tx.knowledgeArticle.update({
          where: { id },
          data: { approvedRevisionId: revisionId },
        });
    });
  }
}
export async function importLegacyTopic(topicId: string) {
  const db = getPrisma();
  const t = await db.topicRecord.findUniqueOrThrow({
    where: { id: topicId },
    include: { document: true },
  });
  if (!t.enrichedBody) return;
  const id = `article-${fingerprint(["legacy", t.id]).slice(0, 24)}`;
  const body = {
    id: t.id,
    title: t.enrichedTitle ?? t.title,
    answer: t.enrichedSummary ?? t.summary,
    markdown: t.enrichedBody,
    exportedFilePath: t.exportedFilePath,
    keyPoints: [],
    details: [],
    relationships: t.relations,
  };
  const revisionId = `revision-${fingerprint([id, body, t.sourcePageNumbers]).slice(0, 24)}`;
  const evidence = {
    legacy: true,
    documentId: t.documentId,
    sourcePageNumbers: t.sourcePageNumbers,
    contentSha256: t.document.contentSha256,
    authority: t.document.sourceAuthority,
    reviewStatus: t.reviewStatus,
  };
  const approval =
    t.reviewStatus === "approved"
      ? {
          by: t.approvedBy,
          at: t.approvedAt,
          mode: t.approvalMode,
          legacy: true,
        }
      : undefined;
  await db.$transaction(async (tx) => {
    await tx.knowledgeArticle.upsert({
      where: { id },
      create: {
        id,
        workspaceId: t.workspaceId,
        collectionId: t.knowledgeBundleId,
        originKind: "topic",
        originId: t.id,
      },
      update: {},
    });
    await tx.knowledgeArticleRevision.upsert({
      where: { id: revisionId },
      create: {
        id: revisionId,
        articleId: id,
        workspaceId: t.workspaceId,
        body: json(body),
        evidence: json(evidence),
        sourceFingerprint: fingerprint(evidence),
        policyVersion: "legacy-snapshot",
        legacy: true,
        ...(approval ? { approval: json(approval) } : {}),
      },
      update: approval ? { approval: json(approval) } : {},
    });
    if (approval)
      await tx.knowledgeArticle.update({
        where: { id },
        data: { approvedRevisionId: revisionId },
      });
  });
}
export async function backfillEditorial(workspaceId: string) {
  const db = getPrisma();
  for (const t of await db.topicRecord.findMany({
    where: { workspaceId, enrichedBody: { not: null } },
    select: { id: true },
  }))
    await importLegacyTopic(t.id);
  for (const r of await db.topicBuilderRun.findMany({
    where: { workspaceId, status: { in: ["ready", "approved"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  }))
    await importBuilderRevision(r.id);
}
export async function assertArticleSourcesCurrent(
  context: AuthWorkspaceContext,
  revisionId: string,
) {
  const db = getPrisma();
  const revision = await db.knowledgeArticleRevision.findFirst({
    where: { id: revisionId, workspaceId: context.workspaceId },
    include: { article: true },
  });
  if (!revision) throw Error("article_unavailable");
  if (
    !(await db.workspaceMember.findFirst({
      where: { workspaceId: context.workspaceId, userId: context.userId },
    }))
  )
    throw Error("knowledge_access_denied");
  if (
    revision.article.collectionId &&
    !(await db.knowledgeBundle.findFirst({
      where: {
        id: revision.article.collectionId,
        workspaceId: context.workspaceId,
        status: "active",
      },
    }))
  )
    throw Error("article_sources_changed");
  if (revision.legacy) {
    const saved = revision.evidence as {
      documentId: string;
      contentSha256: string | null;
    };
    const d = await db.document.findFirst({
      where: {
        workspaceId: context.workspaceId,
        id: saved.documentId,
        deletedAt: null,
        OR: [
          { knowledgeBundleId: null },
          { knowledgeBundle: { is: { status: "active" } } },
        ],
      },
    });
    if (!d || d.contentSha256 !== saved.contentSha256)
      throw Error("article_sources_changed");
  } else {
    const entries = revision.evidence as unknown as BuilderResult["evidence"];
    for (const e of entries) {
      const d = await db.document.findFirst({
        where: {
          id: e.documentId,
          workspaceId: context.workspaceId,
          deletedAt: null,
          OR: [
            { knowledgeBundleId: null },
            { knowledgeBundle: { is: { status: "active" } } },
          ],
        },
      });
      const p = await db.extractedPage.findFirst({
        where: {
          workspaceId: context.workspaceId,
          documentId: e.documentId,
          pageNumber: e.page,
        },
      });
      if (
        !d ||
        !p ||
        !p.text
          .replace(/\s+/g, " ")
          .includes(e.quote.replace(/\s+/g, " ").trim()) ||
        (d.revision ?? "unknown") !== e.revision
      )
        throw Error("article_sources_changed");
    }
  }
  return revision;
}
