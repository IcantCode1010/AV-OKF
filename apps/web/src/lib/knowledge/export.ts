import { normalizeEfbAircraftFamily } from "../efb-aircraft-catalog.ts";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import {
  EFB_POC_AUTHORITY_LABEL,
  EFB_UNREVIEWED_LICENSE_IDENTIFIER,
  exportEfbRelease,
} from "../efb-release-export.ts";
import {
  loadProjectEfbContractRegistry,
  type ProjectEfbContractRegistry,
} from "../project-efb-contract-registry.ts";
import { assertArticleSourcesCurrent } from "./editorial.ts";
import { activeArticleVisuals } from "./visual-revisions.ts";
import { getObjectStorage } from "../production-storage.ts";
import { fingerprint } from "../topic-builder-core.ts";
const exec = promisify(execFile),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const selectionMetadataSchema = z
  .object({
    aircraftTypeIds: z.array(z.string().regex(/^[a-z0-9-]+$/)),
    aircraftFamily: z.string().min(1).transform(normalizeEfbAircraftFamily),
    ataChapter: z
      .string()
      .trim()
      .regex(/^\d{2}$/)
      .nullable(),
    audiences: z.array(z.enum(["pilot", "maintenance"])).min(1),
    qrhTargetId: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .nullable(),
    effectivity: z.string().max(2000).nullable().optional(),
  })
  .superRefine((metadata, context) => {
    if (metadata.audiences.includes("maintenance") && !metadata.ataChapter) {
      context.addIssue({
        code: "custom",
        message: "Choose an ATA placement for maintenance content.",
        path: ["ataChapter"],
      });
    }
    if (metadata.audiences.includes("pilot") && !metadata.qrhTargetId) {
      context.addIssue({
        code: "custom",
        message: "Choose a QRH placement for pilot content.",
        path: ["qrhTargetId"],
      });
    }
  });

export type SelectionMetadata = z.infer<typeof selectionMetadataSchema>;
function canonicalSnapshot(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
async function visualSnapshot(workspaceId: string, revisionId: string) {
  return activeArticleVisuals(
    await getPrisma().knowledgeVisual.findMany({
      where: { workspaceId, articleRevisionId: revisionId },
      orderBy: { id: "asc" },
    }),
  ).map((v) => ({
    id: v.id,
    provenance: v.provenance,
    caption: v.caption,
    altText: v.altText,
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
  }));
}

export function assertSelectionMetadataAllowed(
  metadata: SelectionMetadata,
  registry: ProjectEfbContractRegistry,
): void {
  const family = registry.aircraftFamilies.find(
    ({ id }) => id === metadata.aircraftFamily,
  );
  if (
    !family ||
    metadata.aircraftTypeIds.some((id) => !family.aircraftTypeIds.includes(id))
  ) {
    throw new Error("selected_aircraft_not_supported_by_project_efb");
  }
  if (
    metadata.ataChapter &&
    !registry.placements.ataChapterIds.includes(metadata.ataChapter)
  ) {
    throw new Error("selected_ata_not_supported_by_project_efb");
  }
  if (
    metadata.qrhTargetId &&
    !registry.placements.qrhTargetIds.includes(metadata.qrhTargetId)
  ) {
    throw new Error("selected_qrh_not_supported_by_project_efb");
  }
}
export async function exportSelectedArticles(
  context: AuthWorkspaceContext,
  selectionIds?: string[],
  queuedReleaseId?: string,
) {
  const db = getPrisma();
  const contractRoot = process.env.PROJECT_EFB_ROOT,
    signingKeyPath = process.env.AV_OKF_EFB_SIGNING_KEY_PATH,
    signingKeyId = process.env.AV_OKF_EFB_SIGNING_KEY_ID;
  if (!contractRoot) throw Error("configure_project_efb_validator_first");
  const signedPrototype = Boolean(signingKeyPath && signingKeyId);
  const registry = await loadProjectEfbContractRegistry(contractRoot);
  const queued = queuedReleaseId
    ? await db.knowledgeExportRelease.findFirstOrThrow({
        where: { id: queuedReleaseId, workspaceId: context.workspaceId },
      })
    : null;
  if (queued?.status === "exported") return queued.id;
  if (queued && !["queued", "validating"].includes(queued.status))
    throw Error("release_not_queued");
  const selections = queued
    ? (queued.selectionSnapshot as unknown as Awaited<
        ReturnType<typeof db.knowledgeEfbSelection.findMany>
      >)
    : await db.knowledgeEfbSelection.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(selectionIds ? { id: { in: selectionIds } } : {}),
        },
        orderBy: { articleId: "asc" },
      });
  if (!selections.length) throw Error("select_articles_first");
  if (selectionIds && selections.length !== new Set(selectionIds).size)
    throw Error("selection_scope_changed");
  if (!queued && process.env.AV_OKF_EFB_BULK_EXPORT_ENABLED === "true") {
    const pinned = await Promise.all(
      selections.map(async (s) => ({
        ...s,
        visualSnapshot: await visualSnapshot(context.workspaceId, s.revisionId),
      })),
    );
    const release = await db.knowledgeExportRelease.create({
      data: {
        workspaceId: context.workspaceId,
        createdBy: context.userId,
        status: "queued",
        selectionSnapshot: json(pinned),
      },
    });
    return release.id;
  }
  const failures: Array<{
    articleId: string;
    revisionId: string;
    reason: string;
  }> = [];
  for (const s of selections) {
    try {
      const pinnedVisuals = (s as typeof s & { visualSnapshot?: unknown })
        .visualSnapshot;
      if (
        pinnedVisuals &&
        canonicalSnapshot(pinnedVisuals) !==
          canonicalSnapshot(
            await visualSnapshot(context.workspaceId, s.revisionId),
          )
      )
        throw Error("visuals_changed_after_snapshot");
      const r = await assertArticleSourcesCurrent(context, s.revisionId);
      if (!r.approval || r.article.approvedRevisionId !== r.id)
        throw Error("approved_current_revision_required");
      const current = await db.knowledgeEfbSelection.findFirst({
        where: { id: s.id, workspaceId: context.workspaceId },
      });
      if (
        !current ||
        current.revisionId !== s.revisionId ||
        JSON.stringify(current.metadata) !== JSON.stringify(s.metadata)
      )
        throw Error("selection_changed_after_snapshot");
      assertSelectionMetadataAllowed(
        selectionMetadataSchema.parse(s.metadata),
        registry,
      );
      const extended = s.metadata as {
        classificationId?: string;
        registryHash?: string;
        selectionMode?: string;
      };
      const { registryFingerprint } = await import(
        "../project-efb-contract-registry.ts"
      );
      if (
        extended.registryHash &&
        extended.registryHash !== registryFingerprint(registry)
      )
        throw Error("registry_changed_review_selection");
      if (extended.classificationId) {
        const { currentClassification } = await import(
          "./efb-classification.ts"
        );
        const classification = await currentClassification(
          context,
          s.revisionId,
        );
        if (
          classification?.id !== extended.classificationId ||
          (extended.selectionMode === "automatic" &&
            classification.status !== "ready")
        )
          throw Error("classification_changed_review_selection");
      }
    } catch (error) {
      failures.push({
        articleId: s.articleId,
        revisionId: s.revisionId,
        reason: error instanceof Error ? error.message : "preflight_failed",
      });
    }
  }
  if (failures.length) {
    if (queued)
      await db.knowledgeExportRelease.update({
        where: { id: queued.id },
        data: {
          status: "validation_failed",
          error: "article_preflight_failed",
          result: json({ failures }),
        },
      });
    throw Error("article_preflight_failed");
  }
  const records = await Promise.all(
    selections.map((s) => assertArticleSourcesCurrent(context, s.revisionId)),
  );
  const metadata = selections.map((s) =>
    selectionMetadataSchema.parse(s.metadata),
  );
  for (const item of metadata) assertSelectionMetadataAllowed(item, registry);
  const release =
    queued ??
    (await db.knowledgeExportRelease.create({
      data: {
        workspaceId: context.workspaceId,
        createdBy: context.userId,
        status: "validating",
        selectionSnapshot: json(selections),
      },
    }));
  if (queued) {
    const claimed = await db.knowledgeExportRelease.updateMany({
      where: { id: queued.id, status: { in: ["queued", "validating"] } },
      data: { status: "validating" },
    });
    if (!claimed.count) throw Error("release_not_queued");
  }
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-poc-cloud-"));
  try {
    const privateKey = signingKeyPath
      ? createPrivateKey(await readFile(signingKeyPath, "utf8"))
      : null;
    if (privateKey && privateKey.asymmetricKeyType !== "ed25519")
      throw Error("efb_signing_key_must_be_ed25519");
    const publicKeyPath = privateKey ? path.join(scratch, "signer-public.pem") : null;
    if (privateKey && publicKeyPath) {
      await writeFile(
        publicKeyPath,
        createPublicKey(privateKey).export({ format: "pem", type: "spki" }),
      );
    }
    const sourceEntries: Array<{ markdown: string; relativePath: string }> = [];
    const supportingAssets: NonNullable<
      Parameters<typeof exportEfbRelease>[0]["supportingAssets"]
    > = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i],
        m = metadata[i],
        entryId = r.articleId;
      const b = r.body as {
        id: string;
        title: string;
        answer: string;
        evidenceIds?: string[];
        markdown?: string;
        keyPoints?: Array<{ text: string; evidenceIds?: string[] }>;
        details?: Array<{
          heading: string;
          text: string;
          evidenceIds?: string[];
        }>;
        relationships?: Array<{ target: string; relation?: string }>;
      };
      const approval = (r.approval ?? {}) as {
        by?: string;
        at?: string;
        mode?: string;
        legacy?: boolean;
      };
      const related = (b.relationships ?? []).flatMap((link) => {
        const target = records.find(
          (other) => (other.body as { id: string }).id === link.target,
        )?.articleId;
        return target
          ? [{ relation: link.relation ?? "related_to", target }]
          : [];
      });
      const e = r.evidence as
        | Array<{
            id?: string;
            documentId: string;
            documentTitle: string;
            page: number;
            quote?: string;
          }>
        | { documentId: string; sourcePageNumbers: number[] };
      const passages = Array.isArray(e)
        ? e
        : e.sourcePageNumbers.map((page) => ({
            documentId: e.documentId,
            documentTitle: e.documentId,
            page,
          }));
      const refs = (ids: string[] = []) => ids.map((id) => `[^${id}]`).join("");
      const sourcePages = [...new Set(passages.map((p) => p.page))];
      const displayOrder = (sourcePages[0] ?? 1) * 10;
      const placements = [
        ...(m.audiences.includes("maintenance") && m.ataChapter
          ? [`ata:${m.ataChapter}:${displayOrder}`]
          : []),
        ...(m.audiences.includes("pilot") && m.qrhTargetId
          ? [`qrh:${m.qrhTargetId}:${displayOrder}`]
          : []),
      ];
      const frontmatter = {
        article_version: r.version,
        article_revision_id: r.id,
        article_parent_revision_id: r.parentRevisionId,
        article_change_reason: r.changeReason,
        relations: related.map((link) => ({
          relation: link.relation,
          target: `${link.target}.md`,
        })),
        type: "system_topic",
        title: b.title,
        description: b.answer,
        status: "stable",
        generated: { by: "av-okf", at: r.createdAt.toISOString() },
        ...(approval.by && approval.at
          ? { verified: [{ by: `human:${approval.by}`, at: approval.at }] }
          : {}),
        sources: passages.map((p) => ({
          id: `${p.documentId}-${p.page}`,
          resource: `urn:av-okf:document:${p.documentId}:page:${p.page}`,
          title: `${p.documentTitle}, page ${p.page}`,
        })),
        source_pages: sourcePages,
        aircraft_family_ids: [m.aircraftFamily],
        aircraft_type_ids: m.aircraftTypeIds,
        effectivity: m.effectivity,
        ...(m.ataChapter ? { ata: m.ataChapter } : {}),
        efb_entry_id: entryId,
        intended_audiences: m.audiences,
        efb_aircraft_family_ids: [m.aircraftFamily],
        efb_aircraft_type_ids: m.aircraftTypeIds,
        efb_audiences: m.audiences,
        efb_placements: placements,
        efb_license_identifier: EFB_UNREVIEWED_LICENSE_IDENTIFIER,
        efb_authority_label: EFB_POC_AUTHORITY_LABEL,
        efb_inclusion_status: "approved-for-inclusion",
        efb_related_entry_ids: related.map(({ target }) => target),
      };
      const body =
        b.markdown ??
        `# ${b.title}\n\n${b.answer} ${refs(b.evidenceIds)}\n\n${b.keyPoints?.map((p) => `- ${p.text} ${refs(p.evidenceIds)}`).join("\n") ?? ""}\n\n${b.details?.map((d) => `## ${d.heading}\n\n${d.text} ${refs(d.evidenceIds)}`).join("\n\n") ?? ""}`;
      const footnotes = Array.isArray(e)
        ? e
            .map(
              (p) =>
                `[^${p.id}]: ${p.documentTitle}, page ${p.page}. ${p.quote ?? ""}`,
            )
            .join("\n\n")
        : "";
      const relationLinks =
        related.length > 0
          ? `\n\n## Related topics\n\n${related.map(({ target }) => `- [${target}](${target}.md)`).join("\n")}`
          : "";
      const visuals = activeArticleVisuals(
        await db.knowledgeVisual.findMany({
          where: { workspaceId: context.workspaceId, articleRevisionId: r.id },
        }),
      );
      let visualMarkdown = "";
      for (const visual of visuals) {
        if (!visual.reviewedAt) throw Error("review_visuals_before_export");
        const provenance = visual.provenance as {
          objectKey: string;
          hash: string;
        };
        if (
          !provenance.objectKey.startsWith(
            `workspaces/${context.workspaceId}/article-visuals/`,
          )
        )
          throw Error("visual_scope_mismatch");
        const bytes = await getObjectStorage().getObject(provenance.objectKey);
        if (fingerprint([...bytes]) !== provenance.hash)
          throw Error("visual_checksum_mismatch");
        const nativePath = `${visual.id}.png`,
          sourcePath = path.join(scratch, nativePath);
        await writeFile(sourcePath, bytes);
        supportingAssets.push({
          nativePath,
          sourcePath,
          entryId,
          title: visual.caption,
          mediaType: "image/png",
        });
        visualMarkdown += `\n\n![${visual.altText.replace(/[\[\]\r\n]/g, " ")}](../assets/${nativePath})\n\n${visual.caption}`;
      }
      sourceEntries.push({
        relativePath: `topics/${entryId}.md`,
        markdown: `---\n${stringify(frontmatter, { aliasDuplicateObjects: false })}---\n\n${body}${relationLinks}${visualMarkdown}\n\n${footnotes}`,
      });
    }
    const now = new Date().toISOString();
    const sourceCommit = createHash("sha256")
      .update(JSON.stringify(sourceEntries), "utf8")
      .digest("hex")
      .slice(0, 40);
    const result = await exportEfbRelease({
      config: {
        schemaVersion: "1.0",
        mode: signedPrototype ? "poc-cloud" : "poc-local",
        packageId: `selected-${context.workspaceId.toLowerCase()}`,
        version: `0.1.${release.createdAt.getTime()}`,
        source: "av-okf",
        sourceCommit,
        curator: "av-okf-poc-export",
        curatedAt: now,
        validatedAt: now,
        validator: "av-okf-poc-export",
        validationProfile: "poc-structural-only",
        license: {
          identifier: EFB_UNREVIEWED_LICENSE_IDENTIFIER,
          attribution: "Prototype content",
        },
      },
      contractRegistry: registry,
      sourceEntries,
      supportingAssets,
      outputRoot: process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
      validateStagedPackage: async (manifest) => {
        const { registryFingerprint } = await import(
          "../project-efb-contract-registry.ts"
        );
        if (
          registryFingerprint(await loadProjectEfbContractRegistry()) !==
          registryFingerprint(registry)
        )
          throw Error("registry_changed_during_export");
        for (const selection of selections) {
          const latest = await db.knowledgeEfbSelection.findFirst({
            where: { id: selection.id, workspaceId: context.workspaceId },
          });
          if (
            !latest ||
            latest.revisionId !== selection.revisionId ||
            JSON.stringify(latest.metadata) !==
              JSON.stringify(selection.metadata)
          )
            throw Error("selection_changed_during_export");
          const saved = selection.metadata as { classificationId?: string };
          if (saved.classificationId) {
            const { currentClassification } = await import(
              "./efb-classification.ts"
            );
            if (
              (await currentClassification(context, selection.revisionId))
                ?.id !== saved.classificationId
            )
              throw Error("classification_changed_during_export");
          }
        }
        for (const r of records) {
          const current = await assertArticleSourcesCurrent(context, r.id);
          if (!current.approval || current.article.approvedRevisionId !== r.id)
            throw Error("approval_changed_during_export");
        }
        const validatorArgs = [
          path.join(contractRoot, "scripts/validate-knowledge-package.mjs"),
          manifest,
        ];
        if (signedPrototype && publicKeyPath && signingKeyId) {
          validatorArgs.push(
            "--require-signature",
            "--public-key",
            publicKeyPath,
            "--expected-key-id",
            signingKeyId,
          );
        }
        await exec(process.execPath, validatorArgs, { cwd: contractRoot });
      },
      signer: privateKey && signingKeyId
        ? async (payload) => ({
            algorithm: "ed25519" as const,
            keyId: signingKeyId,
            value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
          })
        : undefined,
    });
    await db.knowledgeExportRelease.update({
      where: { id: release.id },
      data: {
        status: "exported",
        result: json({
          releaseDirectory: result.releaseDirectory,
          manifest: result.manifest,
        }),
      },
    });
    return release.id;
  } catch (error) {
    const errorCode =
      error instanceof Error
        ? error.message.split(":", 1)[0]!
        : "export_validation_failed";
    await db.knowledgeExportRelease.update({
      where: { id: release.id },
      data: {
        status: "failed",
        error: /^[a-z_]+$/.test(errorCode)
          ? errorCode
          : "export_validation_failed",
      },
    });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
