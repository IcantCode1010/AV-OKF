import { activeArticleVisuals } from "./visual-revisions.ts";
import { matchesEfbAircraftFamily, normalizeEfbAircraftFamily } from "../efb-aircraft-catalog.ts";
import { createPublicKey, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { getObjectStorage } from "../production-storage.ts";
import { exportEfbRelease } from "../efb-release-export.ts";
import { assertArticleSourcesCurrent } from "./editorial.ts";
const exec = promisify(execFile),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const selectionMetadataSchema = z.object({
  aircraftTypeIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  aircraftFamily: z.string().min(1).transform(normalizeEfbAircraftFamily),
  effectivity: z.string().min(1),
  audiences: z.array(z.enum(["pilot", "maintenance"])).min(1),
  placements: z
    .array(z.string().regex(/^(ata|qrh|quick-access):[^:]+:\d+$/))
    .min(1),
  authority: z.string().min(10),
  license: z.string().min(1),
  attribution: z.string().min(1),
}).refine((metadata) => matchesEfbAircraftFamily(metadata.aircraftFamily, metadata.aircraftTypeIds), {
  message: "Choose supported aircraft types from the selected family.", path: ["aircraftTypeIds"],
});
export async function exportSelectedArticles(
  context: AuthWorkspaceContext,
  selectionIds?: string[],
) {
  const db = getPrisma();
  const keyPath = process.env.AV_OKF_EFB_SIGNING_KEY_PATH,
    keyId = process.env.AV_OKF_EFB_SIGNING_KEY_ID,
    sourceCommit = process.env.AV_OKF_SOURCE_COMMIT,
    contractRoot = process.env.PROJECT_EFB_ROOT;
  if (!keyPath || !keyId || !sourceCommit || !contractRoot)
    throw Error("configure_signed_efb_export_first");
  const selections = await db.knowledgeEfbSelection.findMany({
    where: {
      workspaceId: context.workspaceId,
      ...(selectionIds ? { id: { in: selectionIds } } : {}),
    },
    orderBy: { articleId: "asc" },
  });
  if (!selections.length) throw Error("select_articles_first");
  const records = await Promise.all(
    selections.map((s) => assertArticleSourcesCurrent(context, s.revisionId)),
  );
  for (const r of records)
    if (!r.approval) throw Error("selected_revision_not_approved");
  const metadata = selections.map((s) =>
    selectionMetadataSchema.parse(s.metadata),
  );
  if (new Set(metadata.map((m) => m.license)).size !== 1)
    throw Error("selected_package_license_conflict");
  const release = await db.knowledgeExportRelease.create({
    data: {
      workspaceId: context.workspaceId,
      createdBy: context.userId,
      status: "validating",
      selectionSnapshot: json(selections),
    },
  });
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-selected-"));
  try {
    const sourceEntries: Array<{ markdown: string; relativePath: string }> = [],
      supportingAssets: Array<{
        nativePath: string;
        sourcePath: string;
        entryId: string;
        title: string;
        mediaType: "image/png";
      }> = [];
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
      const approval = r.approval as {
        by?: string;
        at?: string;
        mode?: string;
        legacy?: boolean;
      };
      if (
        !approval.by ||
        !approval.at ||
        (approval.legacy && !approval.mode?.startsWith("human_"))
      )
        throw Error("legacy_revision_requires_explicit_review");
      const related = (b.relationships ?? []).map((link) => {
        const target = records.find(
          (other) => (other.body as { id: string }).id === link.target,
        );
        if (!target) throw Error("select_required_related_article");
        return target.articleId;
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
      const assets = activeArticleVisuals(
        await db.knowledgeVisual.findMany({
          where: { workspaceId: context.workspaceId, articleRevisionId: r.id },
          orderBy: { id: "asc" },
        }),
      );
      for (const asset of assets) {
        if (!asset.reviewedAt) throw Error("selected_visual_not_reviewed");
        const sourcePath = path.join(scratch, `${asset.id}.png`);
        await writeFile(
          sourcePath,
          await getObjectStorage().getObject(
            (asset.provenance as { objectKey: string }).objectKey,
          ),
        );
        supportingAssets.push({
          nativePath: `assets/${asset.id}.png`,
          sourcePath,
          entryId,
          title: asset.caption,
          mediaType: "image/png",
        });
      }
      const refs = (ids: string[] = []) => ids.map((id) => `[^${id}]`).join("");
      const frontmatter = {
        relations: related.map((target, j) => ({
          relation: b.relationships?.[j]?.relation ?? "related_to",
          target: `${target}.md`,
        })),
        type: "system_topic",
        title: b.title,
        description: b.answer,
        status: "stable",
        generated: { by: "av-okf", at: r.createdAt.toISOString() },
        verified: [{ by: `human:${approval.by}`, at: approval.at }],
        sources: passages.map((p) => ({
          id: `${p.documentId}-${p.page}`,
          resource: `urn:av-okf:document:${p.documentId}:page:${p.page}`,
          title: `${p.documentTitle}, page ${p.page}`,
        })),
        source_pages: [...new Set(passages.map((p) => p.page))],
        aircraft_family: m.aircraftFamily,
        effectivity: m.effectivity,
        ata: m.placements.find((p) => p.startsWith("ata:"))?.split(":")[1],
        source_authority: m.authority,
        efb_entry_id: entryId,
        efb_audiences: m.audiences,
        efb_aircraft_type_ids: m.aircraftTypeIds,
        efb_placements: m.placements,
        efb_authority_label: m.authority,
        efb_license_identifier: m.license,
        efb_license_reviewed_by: `human:${selections[i].createdBy}`,
        efb_license_reviewed_at: selections[i].updatedAt.toISOString(),
        efb_content_purpose: "educational-reference",
        efb_inclusion_status: "approved-for-inclusion",
        efb_source_classification: "training-reference",
        efb_related_entry_ids: related,
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
      sourceEntries.push({
        relativePath: `topics/${entryId}.md`,
        markdown: `---\n${stringify(frontmatter)}---\n\n${body}\n\n${footnotes}\n\n${assets.map((a) => `![${a.altText.replace(/[\[\]]/g, "")}](/assets/${a.id}.png)\n\n${a.caption}`).join("\n\n")}`,
      });
    }
    const key = await readFile(keyPath);
    const publicKeyPath = path.join(scratch, "signer-public.pem");
    await writeFile(
      publicKeyPath,
      createPublicKey(key).export({ type: "spki", format: "pem" }),
    );
    const now = new Date().toISOString();
    const result = await exportEfbRelease({
      config: {
        schemaVersion: "1.0",
        mode: "production",
        packageId: `selected-${context.workspaceId.toLowerCase()}`,
        version: `0.1.${Date.now()}`,
        source: "av-okf",
        sourceCommit,
        curator: `human:${context.userId}`,
        curatedAt: now,
        validatedAt: now,
        validator: "av-okf-selected-export",
        validationProfile: "selected-educational-v1",
        license: {
          identifier: metadata[0].license,
          attribution: metadata.map((m) => m.attribution).join("; "),
        },
      },
      sourceEntries,
      supportingAssets,
      outputRoot: process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
      signer: async (payload) => ({
        algorithm: "ed25519",
        keyId,
        value: sign(null, Buffer.from(payload), key).toString("base64"),
      }),
      validateStagedPackage: async (manifest) => {
        for (const r of records)
          await assertArticleSourcesCurrent(context, r.id);
        await exec(
          process.execPath,
          [
            path.join(contractRoot, "scripts/validate-knowledge-package.mjs"),
            manifest,
            "--require-signature",
            "--public-key",
            publicKeyPath,
            "--expected-key-id",
            keyId,
          ],
          { cwd: contractRoot },
        );
      },
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
    await db.knowledgeExportRelease.update({
      where: { id: release.id },
      data: {
        status: "failed",
        error:
          error instanceof Error && /^[a-z_]+$/.test(error.message)
            ? error.message
            : "export_validation_failed",
      },
    });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
