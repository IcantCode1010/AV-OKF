import { matchesEfbAircraftFamily, normalizeEfbAircraftFamily } from "../efb-aircraft-catalog.ts";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
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
const exec = promisify(execFile),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const selectionMetadataSchema = z.object({
  aircraftTypeIds: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  aircraftFamily: z.string().min(1).transform(normalizeEfbAircraftFamily),
  ataChapter: z.string().trim().regex(/^\d{2}$/).nullable(),
  audiences: z.array(z.enum(["pilot", "maintenance"])).min(1),
  qrhTargetId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
}).refine((metadata) => matchesEfbAircraftFamily(metadata.aircraftFamily, metadata.aircraftTypeIds), {
  message: "Choose supported aircraft types from the selected family.", path: ["aircraftTypeIds"],
}).superRefine((metadata, context) => {
  if (metadata.audiences.includes("maintenance") && !metadata.ataChapter) {
    context.addIssue({ code: "custom", message: "Choose an ATA placement for maintenance content.", path: ["ataChapter"] });
  }
  if (metadata.audiences.includes("pilot") && !metadata.qrhTargetId) {
    context.addIssue({ code: "custom", message: "Choose a QRH placement for pilot content.", path: ["qrhTargetId"] });
  }
});

export type SelectionMetadata = z.infer<typeof selectionMetadataSchema>;

export function assertSelectionMetadataAllowed(
  metadata: SelectionMetadata,
  registry: ProjectEfbContractRegistry,
): void {
  const family = registry.aircraftFamilies.find(({ id }) => id === metadata.aircraftFamily);
  if (!family || metadata.aircraftTypeIds.some((id) => !family.aircraftTypeIds.includes(id))) {
    throw new Error("selected_aircraft_not_supported_by_project_efb");
  }
  if (metadata.ataChapter && !registry.placements.ataChapterIds.includes(metadata.ataChapter)) {
    throw new Error("selected_ata_not_supported_by_project_efb");
  }
  if (metadata.qrhTargetId && !registry.placements.qrhTargetIds.includes(metadata.qrhTargetId)) {
    throw new Error("selected_qrh_not_supported_by_project_efb");
  }
}
export async function exportSelectedArticles(
  context: AuthWorkspaceContext,
  selectionIds?: string[],
) {
  const db = getPrisma();
  const contractRoot = process.env.PROJECT_EFB_ROOT,
    signingKeyPath = process.env.AV_OKF_EFB_SIGNING_KEY_PATH,
    signingKeyId = process.env.AV_OKF_EFB_SIGNING_KEY_ID;
  if (!contractRoot) throw Error("configure_project_efb_validator_first");
  if (!signingKeyPath || !signingKeyId) throw Error("configure_poc_cloud_signing_first");
  const registry = await loadProjectEfbContractRegistry(contractRoot);
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
  const metadata = selections.map((s) =>
    selectionMetadataSchema.parse(s.metadata),
  );
  for (const item of metadata) assertSelectionMetadataAllowed(item, registry);
  const release = await db.knowledgeExportRelease.create({
    data: {
      workspaceId: context.workspaceId,
      createdBy: context.userId,
      status: "validating",
      selectionSnapshot: json(selections),
    },
  });
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-poc-cloud-"));
  try {
    const privateKey = createPrivateKey(await readFile(signingKeyPath, "utf8"));
    if (privateKey.asymmetricKeyType !== "ed25519") throw Error("efb_signing_key_must_be_ed25519");
    const publicKeyPath = path.join(scratch, "signer-public.pem");
    await writeFile(publicKeyPath, createPublicKey(privateKey).export({ format: "pem", type: "spki" }));
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
        relations: related.map((link) => ({
          relation: link.relation,
          target: `${link.target}.md`,
        })),
        type: "system_topic",
        title: b.title,
        description: b.answer,
        status: "stable",
        generated: { by: "av-okf", at: r.createdAt.toISOString() },
        ...(approval.by && approval.at ? { verified: [{ by: `human:${approval.by}`, at: approval.at }] } : {}),
        sources: passages.map((p) => ({
          id: `${p.documentId}-${p.page}`,
          resource: `urn:av-okf:document:${p.documentId}:page:${p.page}`,
          title: `${p.documentTitle}, page ${p.page}`,
        })),
        source_pages: sourcePages,
        aircraft_family_ids: [m.aircraftFamily],
        aircraft_type_ids: m.aircraftTypeIds,
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
      const relationLinks = related.length > 0
        ? `\n\n## Related topics\n\n${related.map(({ target }) => `- [${target}](${target}.md)`).join("\n")}`
        : "";
      sourceEntries.push({
        relativePath: `topics/${entryId}.md`,
        markdown: `---\n${stringify(frontmatter)}---\n\n${body}${relationLinks}\n\n${footnotes}`,
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
        mode: "poc-cloud",
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
      contractRegistry: registry,
      sourceEntries,
      outputRoot: process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
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
            signingKeyId,
          ],
          { cwd: contractRoot },
        );
      },
      signer: async (payload) => ({
        algorithm: "ed25519",
        keyId: signingKeyId,
        value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
      }),
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
    const errorCode = error instanceof Error ? error.message.split(":", 1)[0]! : "export_validation_failed";
    await db.knowledgeExportRelease.update({
      where: { id: release.id },
      data: {
        status: "failed",
        error: /^[a-z_]+$/.test(errorCode) ? errorCode : "export_validation_failed",
      },
    });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
