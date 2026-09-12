import { suggestArticleDiagram } from "./diagram-authoring.ts";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { createTopicRecipe, refreshTopicRecipe } from "../topic-builder.ts";
import { knowledgeFeature } from "./contracts.ts";
import { assertArticleSourcesCurrent, backfillEditorial, importLegacyTopic } from "./editorial.ts";
import { addArticleVisual } from "./media.ts";
import {
  assertSelectionMetadataAllowed,
  exportSelectedArticles,
  selectionMetadataSchema,
} from "./export.ts";
import { loadProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";
import { activeArticleVisuals } from "./visual-revisions.ts";
import { getObjectStorage } from "../production-storage.ts";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export async function approveArticleRevision(
  context: AuthWorkspaceContext,
  revisionId: string,
) {
  const db = getPrisma();
  const revision = await assertArticleSourcesCurrent(context, revisionId);
  if (revision.approval) {
    if (revision.article.approvedRevisionId === revisionId) return "already_approved" as const;
    throw Error("revision_already_approved");
  }
  const unreviewed = activeArticleVisuals(
    await db.knowledgeVisual.findMany({
      where: { workspaceId: context.workspaceId, articleRevisionId: revisionId },
    }),
  ).some((visual) => !visual.reviewedAt);
  if (unreviewed) throw Error("review_visuals_before_approval");

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "KnowledgeArticleRevision" WHERE id = ${revisionId} FOR UPDATE`;
    const current = await tx.knowledgeArticleRevision.findFirstOrThrow({
      where: { id: revisionId, workspaceId: context.workspaceId },
      select: { approval: true },
    });
    if (current.approval) return;
    if (
      activeArticleVisuals(
        await tx.knowledgeVisual.findMany({
          where: { workspaceId: context.workspaceId, articleRevisionId: revisionId },
        }),
      ).some((visual) => !visual.reviewedAt)
    ) throw Error("review_visuals_before_approval");
    await tx.knowledgeArticleRevision.update({
      where: { id: revisionId },
      data: {
        approval: json({
          by: context.userId,
          at: new Date().toISOString(),
          source: "editorial",
        }),
      },
    });
    await tx.knowledgeArticle.update({
      where: { id: revision.articleId },
      data: { approvedRevisionId: revisionId },
    });
  });

  if (
    process.env.AV_OKF_EFB_AUTO_SELECT_ENABLED === "true" &&
    knowledgeFeature("export")
  ) {
    const { selectClassifiedRevision } = await import("./efb-classification.ts");
    await selectClassifiedRevision(context, revisionId);
  }
  return "approved" as const;
}

export async function executeEditorialAction(
  context: AuthWorkspaceContext,
  form: FormData,
) {
  if (!knowledgeFeature("shared")) throw Error("shared_knowledge_not_enabled");
  const db = getPrisma(),
    action = String(form.get("action")),
    id = String(form.get("revisionId") ?? "");
  if (action === "backfill")
    await backfillEditorial(context.workspaceId, context);
  else if (action === "delete-articles") {
    const revisionIds = [...new Set(form.getAll("revisionId").map(String).filter(Boolean))];
    if (!revisionIds.length || revisionIds.length > 500) throw Error("select_up_to_500_revisions");
    const articles = await db.knowledgeArticle.findMany({
      where: { workspaceId: context.workspaceId, revisions: { some: { id: { in: revisionIds } } } },
      select: { id: true, revisions: { select: { id: true } } },
      orderBy: { id: "asc" },
    });
    if (articles.length !== revisionIds.length) throw Error("article_delete_scope_changed");
    const articleIds = articles.map((article) => article.id);
    const allRevisionIds = articles.flatMap((article) => article.revisions.map((revision) => revision.id));
    const [classifications, visuals] = await Promise.all([
      db.knowledgeEfbClassification.findMany({
        where: { workspaceId: context.workspaceId, revisionId: { in: allRevisionIds } },
        select: { id: true },
      }),
      db.knowledgeVisual.findMany({
        where: { workspaceId: context.workspaceId, articleRevisionId: { in: allRevisionIds } },
        select: { provenance: true },
      }),
    ]);
    const classificationIds = classifications.map((classification) => classification.id);
    await db.$transaction(async (tx) => {
      if (classificationIds.length) await tx.knowledgeEfbClassificationDecision.deleteMany({ where: { workspaceId: context.workspaceId, classificationId: { in: classificationIds } } });
      await tx.knowledgeEfbClassification.deleteMany({ where: { workspaceId: context.workspaceId, revisionId: { in: allRevisionIds } } });
      await tx.knowledgeVisual.deleteMany({ where: { workspaceId: context.workspaceId, articleRevisionId: { in: allRevisionIds } } });
      await tx.knowledgeEfbSelection.deleteMany({ where: { workspaceId: context.workspaceId, articleId: { in: articleIds } } });
      await tx.knowledgeArticleRevision.deleteMany({ where: { workspaceId: context.workspaceId, articleId: { in: articleIds } } });
      const deleted = await tx.knowledgeArticle.deleteMany({ where: { workspaceId: context.workspaceId, id: { in: articleIds } } });
      if (deleted.count !== articleIds.length) throw Error("article_delete_scope_changed");
    });
    const objectKeys = visuals.flatMap((visual) => {
      const key = (visual.provenance as { objectKey?: unknown } | null)?.objectKey;
      return typeof key === "string" ? [key] : [];
    });
    const storage = getObjectStorage();
    await Promise.allSettled(objectKeys.map((objectKey) => storage.deleteObject(objectKey)));
    return `${articleIds.length} articles were deleted. Source documents, topics, OKF bundles, and completed EFB releases were preserved.`;
  }
  else if (action === "approve-articles") {
    const revisionIds = [...new Set(form.getAll("revisionId").map(String).filter(Boolean))];
    if (!revisionIds.length || revisionIds.length > 500) throw Error("select_up_to_500_revisions");
    let approved = 0;
    let alreadyApproved = 0;
    const failed: string[] = [];
    for (const revisionId of revisionIds) {
      try {
        const result = await approveArticleRevision(context, revisionId);
        if (result === "approved") approved++;
        else alreadyApproved++;
      } catch {
        failed.push(revisionId);
      }
    }
    return `${approved} articles approved${alreadyApproved ? `, ${alreadyApproved} already approved` : ""}${failed.length ? `, and ${failed.length} blocked by source or visual review checks` : ""}.`;
  }
  else if (action === "prepare-and-export-efb") {
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    const revisionIds = [...new Set(form.getAll("revisionId").map(String).filter(Boolean))];
    if (!revisionIds.length || revisionIds.length > 500) throw Error("select_up_to_500_revisions");
    const { synchronizeInheritedClassification, selectClassifiedRevision } = await import("./efb-classification.ts");
    const activeClassificationCount = await db.knowledgeEfbClassification.count({
      where: {
        workspaceId: context.workspaceId,
        status: { in: ["queued", "running"] },
      },
    });
    if (activeClassificationCount)
      return `EFB metadata classification is already processing ${activeClassificationCount} articles. Wait for it to finish before starting another package build.`;
    const failures: string[] = [];
    for (const revisionId of revisionIds) {
      try {
        const revision = await assertArticleSourcesCurrent(context, revisionId);
        if (!revision.approval || revision.article.approvedRevisionId !== revisionId) throw Error("approved_current_revision_required");
        const classification = await synchronizeInheritedClassification(context, revisionId);
        if (classification.status !== "ready") throw Error("efb_metadata_needs_correction");
      } catch {
        failures.push(revisionId);
      }
    }
    if (failures.length) {
      const { requestClassification } = await import("./efb-classification.ts");
      for (const revisionId of failures)
        await requestClassification(context, revisionId);
      return `${failures.length} articles need article-specific placement. Metadata classification has started; build the package again after they become Metadata ready.`;
    }
    for (const revisionId of revisionIds) {
      if (!(await selectClassifiedRevision(context, revisionId))) throw Error("efb_selection_failed");
    }
    const selections = await db.knowledgeEfbSelection.findMany({
      where: { workspaceId: context.workspaceId, revisionId: { in: revisionIds } },
      select: { id: true },
      orderBy: { articleId: "asc" },
    });
    if (selections.length !== revisionIds.length) throw Error("efb_selection_scope_changed");
    const releaseId = await exportSelectedArticles(context, selections.map((selection) => selection.id));
    return `EFB package ${releaseId} was created or queued. Open Package history to download it when validation completes.`;
  }
  else if (action === "prepare-efb-workspace") {
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    const topics = await db.topicRecord.findMany({
      where: { workspaceId: context.workspaceId, reviewStatus: "approved", enrichedBody: { not: null }, document: { deletedAt: null, sourceType: "aviation" } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    let selected = 0;
    let needsAttention = 0;
    const {
      requestClassification,
      synchronizeInheritedClassification,
      selectClassifiedRevision,
    } = await import("./efb-classification.ts");
    for (const topic of topics) {
      try {
        await importLegacyTopic(topic.id);
        const article = await db.knowledgeArticle.findUnique({
          where: { workspaceId_originKind_originId: { workspaceId: context.workspaceId, originKind: "topic", originId: topic.id } },
        });
        if (!article?.approvedRevisionId) {
          needsAttention++;
          continue;
        }
        const classification = await synchronizeInheritedClassification(context, article.approvedRevisionId);
        if (classification.status === "ready" && await selectClassifiedRevision(context, article.approvedRevisionId)) {
          selected++;
        } else {
          await requestClassification(context, article.approvedRevisionId);
          needsAttention++;
        }
      } catch {
        needsAttention++;
      }
    }
    return `${selected} approved articles are ready for package export. ${needsAttention} require article-specific metadata; classification has been queued where possible. Topic proposals retain inherited metadata but are not exportable until enriched and approved.`;
  }
  else if (action === "cancel-classification") {
    await assertArticleSourcesCurrent(context, id);
    await db.knowledgeEfbClassification.updateMany({
      where: {
        workspaceId: context.workspaceId,
        revisionId: id,
        status: "queued",
      },
      data: { status: "cancelled" },
    });
  } else if (action === "cancel-export") {
    const result = await db.knowledgeExportRelease.updateMany({
      where: {
        id: String(form.get("releaseId")),
        workspaceId: context.workspaceId,
        status: "queued",
      },
      data: { status: "cancelled" },
    });
    if (!result.count) throw Error("export_already_started_or_unavailable");
  } else if (action === "classify-batch" || action === "select-ready-batch") {
    if (process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED !== "true")
      throw Error("efb_classification_not_enabled");
    const ids = [...new Set(form.getAll("revisionId").map(String))];
    if (!ids.length || ids.length > 500)
      throw Error("select_up_to_500_revisions");
    if (
      action === "classify-batch" &&
      (await db.knowledgeEfbClassification.count({
        where: {
          workspaceId: context.workspaceId,
          status: { in: ["queued", "running"] },
        },
      })) > 0
    )
      return "EFB metadata classification is already running. Wait for the active batch to finish before starting another one.";
    const { requestClassification, selectClassifiedRevision } = await import(
      "./efb-classification.ts"
    );
    for (const revisionId of ids)
      await assertArticleSourcesCurrent(context, revisionId);
    if (action === "select-ready-batch") {
      if (!knowledgeFeature("export"))
        throw Error("selected_export_not_enabled");
      const { currentClassification } = await import("./efb-classification.ts");
      for (const revisionId of ids) {
        const revision = await assertArticleSourcesCurrent(context, revisionId);
        if (
          !revision.approval ||
          revision.article.approvedRevisionId !== revisionId ||
          (await currentClassification(context, revisionId))?.status !== "ready"
        )
          throw Error("revision_not_ready_review_classification");
      }
      for (const revisionId of ids)
        if (!(await selectClassifiedRevision(context, revisionId)))
          throw Error("revision_not_ready_review_classification");
    } else
      for (const revisionId of ids)
        await requestClassification(context, revisionId);
  } else if (action === "classify") {
    if (process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED !== "true")
      throw Error("efb_classification_not_enabled");
    const { requestClassification } = await import("./efb-classification.ts");
    const job = await requestClassification(context, id);
    if (job.status === "failed" || job.status === "cancelled")
      await db.knowledgeEfbClassification.update({
        where: { id: job.id },
        data: {
          status: "queued",
          result: json({ ...(job.result as object), attempts: 0 }),
        },
      });
  } else if (action === "draft-topic") {
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
    await approveArticleRevision(context, id);
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
        parentRevisionId: r.id,
        changeReason:
          String(form.get("changeReason") ?? "Editorial edit").trim() ||
          "Editorial edit",
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
    if (process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED === "true") {
      const { synchronizeInheritedClassification } = await import("./efb-classification.ts");
      try {
        await synchronizeInheritedClassification(context, next.id);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "aviation_source_metadata_required"
        )
          console.error("article_inherited_efb_metadata_failed", {
            revisionId: next.id,
            error: error instanceof Error ? error.message : "unknown_error",
          });
      }
    }
  } else if (action === "select") {
    const r = await assertArticleSourcesCurrent(context, id);
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    if (!r.approval || r.article.approvedRevisionId !== id)
      throw Error("approve_current_revision_before_selection");
    const metadata = selectionMetadataSchema.parse(
      JSON.parse(String(form.get("metadata"))),
    );
    assertSelectionMetadataAllowed(
      metadata,
      await loadProjectEfbContractRegistry(),
    );
    const { currentClassification } = await import("./efb-classification.ts");
    const classification = await currentClassification(context, id);
    const reason = String(form.get("classificationReason") ?? "").trim();
    if (classification && !reason)
      throw Error("classification_review_reason_required");
    const registryHash = (
      await import("../project-efb-contract-registry.ts")
    ).registryFingerprint(await loadProjectEfbContractRegistry());
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "KnowledgeArticle" WHERE id=${r.articleId} FOR UPDATE`;
      const current = await tx.knowledgeArticle.findUniqueOrThrow({
        where: { id: r.articleId },
      });
      if (current.approvedRevisionId !== id)
        throw Error("approve_current_revision_before_selection");
      if (classification)
        await tx.knowledgeEfbClassificationDecision.create({
          data: {
            workspaceId: context.workspaceId,
            classificationId: classification.id,
            previous: classification.result as Prisma.InputJsonValue,
            result: json(metadata),
            reason,
            createdBy: context.userId,
          },
        });
      await tx.knowledgeEfbSelection.upsert({
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
          metadata: json({
            ...metadata,
            classificationId: classification?.id,
            selectionMode: "reviewed",
            registryHash,
          }),
          createdBy: context.userId,
        },
        update: {
          revisionId: id,
          metadata: json({
            ...metadata,
            classificationId: classification?.id,
            selectionMode: "reviewed",
            registryHash,
          }),
        },
      });
    });
  } else if (action === "unselect")
    await db.knowledgeEfbSelection.deleteMany({
      where: {
        workspaceId: context.workspaceId,
        id: String(form.get("selectionId")),
      },
    });
  else if (action === "publish-export") {
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    const { requestExportPublication } = await import("./release-run.ts");
    const run = await requestExportPublication(context, String(form.get("releaseId") ?? ""));
    return run.status === "completed" ? "This package has already been pushed to EFB." : "Push to EFB queued. Upload, import, verification and activation progress appear below.";
  } else if (action === "export") {
    if (!knowledgeFeature("export")) throw Error("selected_export_not_enabled");
    const selectionIds = form.getAll("selectionId").map(String);
    if (!selectionIds.length) throw Error("select_articles_first");
    const releaseId = await exportSelectedArticles(context, selectionIds);
    return `EFB package ${releaseId} queued. Progress appears below.`;
  } else throw Error("unknown_action");
}
