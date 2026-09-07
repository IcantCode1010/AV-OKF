import { matchesEfbAircraftFamily, normalizeEfbAircraftFamily } from "../efb-aircraft-catalog.ts";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import {
  EFB_UNREVIEWED_LICENSE_IDENTIFIER,
  exportEfbRelease,
} from "../efb-release-export.ts";
import { assertArticleSourcesCurrent } from "./editorial.ts";
const exec = promisify(execFile),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const selectionMetadataSchema = z.object({
  aircraftTypeIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  aircraftFamily: z.string().min(1).transform(normalizeEfbAircraftFamily),
  ataChapter: z.string().trim().regex(/^\d{2}$/, "Enter a two-digit ATA chapter."),
  audiences: z.array(z.enum(["pilot", "maintenance"])).min(1),
}).refine((metadata) => matchesEfbAircraftFamily(metadata.aircraftFamily, metadata.aircraftTypeIds), {
  message: "Choose supported aircraft types from the selected family.", path: ["aircraftTypeIds"],
});
export async function exportSelectedArticles(
  context: AuthWorkspaceContext,
  selectionIds?: string[],
) {
  const db = getPrisma();
  const contractRoot = process.env.PROJECT_EFB_ROOT;
  if (!contractRoot) throw Error("configure_project_efb_validator_first");
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
  const release = await db.knowledgeExportRelease.create({
    data: {
      workspaceId: context.workspaceId,
      createdBy: context.userId,
      status: "validating",
      selectionSnapshot: json(selections),
    },
  });
  try {
    const sourceEntries: Array<{ markdown: string; relativePath: string }> = [];
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
      const related = (b.relationships ?? []).flatMap((link) => {
        const target = records.find(
          (other) => (other.body as { id: string }).id === link.target,
        )?.articleId;
        return target ? [{ relation: link.relation ?? "related_to", target }] : [];
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
      const frontmatter = {
        relations: related.map((link) => ({
          relation: link.relation,
          target: `${link.target}.md`,
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
        aircraft_family_ids: [m.aircraftFamily],
        aircraft_type_ids: m.aircraftTypeIds,
        ata: m.ataChapter,
        efb_entry_id: entryId,
        intended_audiences: m.audiences,
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
        markdown: `---\n${stringify(frontmatter)}---\n\n${body}\n\n${footnotes}`,
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
        mode: "poc",
        packageId: `selected-${context.workspaceId.toLowerCase()}`,
        version: `0.1.${Date.now()}`,
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
      sourceEntries,
      outputRoot: process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
      validateStagedPackage: async (manifest) => {
        for (const r of records)
          await assertArticleSourcesCurrent(context, r.id);
        await exec(
          process.execPath,
          [path.join(contractRoot, "scripts/validate-knowledge-package.mjs"), manifest],
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
  }
}
