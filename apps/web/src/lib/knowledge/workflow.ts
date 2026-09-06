import { suggestArticleDiagram } from "./diagram-authoring.ts";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { createTopicRecipe, refreshTopicRecipe } from "../topic-builder.ts";
import { knowledgeFeature } from "./contracts.ts";
import { assertArticleSourcesCurrent, backfillEditorial } from "./editorial.ts";
import { addArticleVisual } from "./media.ts";
import { exportSelectedArticles, selectionMetadataSchema } from "./export.ts";
import { activeArticleVisuals } from "./visual-revisions.ts";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function executeEditorialAction(
  context: AuthWorkspaceContext,
  form: FormData,
) {
  if (!knowledgeFeature("shared")) throw Error("shared_knowledge_not_enabled");
  const db = getPrisma(),
    action = String(form.get("action")),
    id = String(form.get("revisionId") ?? "");
  if (action === "backfill") await backfillEditorial(context.workspaceId);
  else if (action === "draft-topic") {
    const topic = await db.topicRecord.findFirstOrThrow({
      where: {
        id: String(form.get("topicId")),
        workspaceId: context.workspaceId,
      },
      include: { document: true },
    });
    const existing = await db.topicBuilderRecipe.findFirst({
      where: {
        workspaceId: context.workspaceId,
        topic: topic.title,
        documentIds: { equals: [topic.documentId] },
      },
    });
    const recipe =
      existing ??
      (await createTopicRecipe(context, {
        topic: topic.title,
        audience: "enthusiast",
        applicability: topic.document.effectivity ?? topic.document.title,
        documentIds: [topic.documentId],
        researchMode: knowledgeFeature("authoring") ? "agentic" : "exhaustive",
        maxWords: 300,
      }));
    await refreshTopicRecipe(context, recipe.id);
  } else if (action === "visual")
    await addArticleVisual(context, {
      revisionId: id,
      kind: form.get("kind") === "diagram" ? "diagram" : "source",
      spec: JSON.parse(String(form.get("spec"))),
      caption: String(form.get("caption")),
      altText: String(form.get("altText")),
      replacesId: String(form.get("replacesId") ?? "") || undefined,
    });
  else if (action === "suggest-diagram")
    await suggestArticleDiagram(context, id);
  else if (action === "review-visual") {
    const visual = await db.knowledgeVisual.findFirstOrThrow({
      where: {
        id: String(form.get("visualId")),
        workspaceId: context.workspaceId,
      },
    });
    const revision = await assertArticleSourcesCurrent(
      context,
      visual.articleRevisionId,
    );
    if (revision.approval) throw Error("approved_revision_is_immutable");
    await db.knowledgeVisual.update({
      where: { id: visual.id },
      data: { reviewedBy: context.userId, reviewedAt: new Date() },
    });
  } else if (action === "approve") {
    const r = await assertArticleSourcesCurrent(context, id);
    if (r.approval) throw Error("revision_already_approved");
    const unreviewed = activeArticleVisuals(
      await db.knowledgeVisual.findMany({
        where: { workspaceId: context.workspaceId, articleRevisionId: id },
      }),
    ).some((v) => !v.reviewedAt);
    if (unreviewed) throw Error("review_visuals_before_approval");
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "KnowledgeArticleRevision" WHERE id = ${id} FOR UPDATE`;
      if (
        activeArticleVisuals(
          await tx.knowledgeVisual.findMany({
            where: { workspaceId: context.workspaceId, articleRevisionId: id },
          }),
        ).some((v) => !v.reviewedAt)
      )
        throw Error("review_visuals_before_approval");
      await tx.knowledgeArticleRevision.update({
        where: { id },
        data: {
          approval: json({
            by: context.userId,
            at: new Date().toISOString(),
            source: "editorial",
          }),
        },
      });
      await tx.knowledgeArticle.update({
        where: { id: r.articleId },
        data: { approvedRevisionId: id },
      });
    });
  } else if (action === "edit") {
    const r = await assertArticleSourcesCurrent(context, id);
    const body = r.body as Record<string, unknown>;
    const title = String(form.get("title") ?? body.title).trim(),
      answer = String(form.get("answer") ?? body.answer).trim();
    if (!title || !answer) throw Error("article_title_and_text_required");
    const fields = body as {
      keyPoints?: Array<Record<string, unknown> & { text: string }>;
      details?: Array<
        Record<string, unknown> & { text: string; heading: string }
      >;
    };
    const keyPoints = fields.keyPoints?.map((p, i) => ({
      ...p,
      text: String(form.get(`point-${i}`) ?? p.text).trim(),
    }));
    const details = fields.details?.map((p, i) => ({
      ...p,
      heading: String(form.get(`heading-${i}`) ?? p.heading).trim(),
      text: String(form.get(`detail-${i}`) ?? p.text).trim(),
    }));
    const markdown =
      body.markdown === undefined
        ? undefined
        : String(form.get("markdown") ?? body.markdown);
    if (!r.legacy) {
      const parts = body as {
        keyPoints?: Array<{ text: string }>;
        details?: Array<{ text: string }>;
        maxWords?: number;
      };
      const words = [
        answer,
        ...(keyPoints ?? []).map((p) => p.text),
        ...(details ?? []).map((p) => p.text),
      ]
        .join(" ")
        .trim()
        .split(/\s+/).length;
      if (words > Math.min(parts.maxWords ?? 500, 500))
        throw Error("article_word_budget_exceeded");
    }
    const next = await db.knowledgeArticleRevision.create({
      data: {
        id: `revision-${randomUUID()}`,
        articleId: r.articleId,
        workspaceId: r.workspaceId,
        body: json({ ...body, title, answer, keyPoints, details, markdown }),
        evidence: r.evidence as Prisma.InputJsonValue,
        sourceFingerprint: r.sourceFingerprint,
        policyVersion: r.policyVersion,
        legacy: r.legacy,
      },
    });
    for (const v of activeArticleVisuals(
      await db.knowledgeVisual.findMany({
        where: { workspaceId: context.workspaceId, articleRevisionId: id },
      }),
    ))
      await db.knowledgeVisual.create({
        data: {
          workspaceId: context.workspaceId,
          articleRevisionId: next.id,
          kind: v.kind,
          spec: v.spec as Prisma.InputJsonValue,
          provenance: v.provenance as Prisma.InputJsonValue,
          caption: v.caption,
          altText: v.altText,
        },
      });
  } else if (action === "select") {
    const r = await assertArticleSourcesCurrent(context, id);
    if (!r.approval) throw Error("approve_revision_before_efb_selection");
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    const metadata = selectionMetadataSchema.parse(
      JSON.parse(String(form.get("metadata"))),
    );
    await db.knowledgeEfbSelection.upsert({
      where: {
        workspaceId_articleId: {
          workspaceId: context.workspaceId,
          articleId: r.articleId,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        articleId: r.articleId,
        revisionId: id,
        metadata: json(metadata),
        createdBy: context.userId,
      },
      update: { revisionId: id, metadata: json(metadata) },
    });
  } else if (action === "unselect")
    await db.knowledgeEfbSelection.deleteMany({
      where: {
        workspaceId: context.workspaceId,
        id: String(form.get("selectionId")),
      },
    });
  else if (action === "export") {
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    await exportSelectedArticles(context);
  } else throw Error("unknown_action");
}
