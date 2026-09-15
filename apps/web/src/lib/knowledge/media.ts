import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { getPrisma } from "../prisma.ts";
import { getObjectStorage, streamObjectToFile } from "../production-storage.ts";
import { assertArticleSourcesCurrent } from "./editorial.ts";
import { renderDiagram, renderAnnotations } from "./diagrams.ts";
import { fingerprint } from "../topic-builder-core.ts";
const exec = promisify(execFile),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const cropSchema = z
  .object({
    documentId: z.string(),
    page: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (v) => v.x + v.width <= 1 && v.y + v.height <= 1,
    "Crop must remain inside source page",
  );
export async function addArticleVisual(
  context: AuthWorkspaceContext,
  input: {
    revisionId: string;
    kind: "source" | "diagram";
    spec: unknown;
    caption: string;
    altText: string;
    replacesId?: string;
    generation?: { model: string; provider: string; policyVersion: string };
  },
) {
  if (!input.caption.trim() || !input.altText.trim())
    throw Error("visual_caption_and_alt_required");
  const db = getPrisma(),
    revision = await assertArticleSourcesCurrent(context, input.revisionId);
  if (revision.approval)
    throw Error("create_draft_before_editing_approved_visuals");
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-visual-"));
  try {
    const output = path.join(scratch, "visual.png");
    let provenance: unknown;
    let master: string | undefined;
    if (input.kind === "diagram") {
      const evidence = revision.evidence as Array<{ id: string }>;
      if (!Array.isArray(evidence))
        throw Error("diagram_requires_structured_evidence");
      const svg = renderDiagram(
        input.spec,
        evidence.map((e) => e.id),
      );
      master = svg;
      await writeFile(path.join(scratch, "diagram.svg"), svg);
      await exec(
        "rsvg-convert",
        ["-o", output, path.join(scratch, "diagram.svg")],
        { timeout: 60000 },
      );
      provenance = { conceptual: true, evidenceIds: evidence.map((e) => e.id) };
    } else {
      const crop = cropSchema.parse(input.spec);
      const evidence = revision.evidence as
        | Array<{ documentId: string }>
        | { documentId: string };
      const ids = Array.isArray(evidence)
        ? evidence.map((e) => e.documentId)
        : [evidence.documentId];
      if (!ids.includes(crop.documentId))
        throw Error("visual_source_outside_article");
      const doc = await db.document.findFirstOrThrow({
        where: {
          workspaceId: context.workspaceId,
          id: crop.documentId,
          deletedAt: null,
        },
      });
      if (crop.page > doc.pages) throw Error("visual_page_unavailable");
      const original = await db.documentObject.findFirstOrThrow({
        where: {
          workspaceId: context.workspaceId,
          documentId: doc.id,
          kind: "original_pdf",
        },
      });
      await streamObjectToFile({
        destination: path.join(scratch, "source.pdf"),
        key: original.objectKey,
        storage: getObjectStorage(),
      });
      await exec("pdftoppm", [
        "-f",
        String(crop.page),
        "-l",
        String(crop.page),
        "-r",
        "160",
        "-png",
        "-singlefile",
        path.join(scratch, "source.pdf"),
        path.join(scratch, "page"),
      ]);
      const dimensions = await exec("identify", [
        "-format",
        "%w %h",
        path.join(scratch, "page.png"),
      ]);
      const [w, h] = dimensions.stdout.trim().split(/\s+/).map(Number);
      await exec("convert", [
        path.join(scratch, "page.png"),
        "-crop",
        `${Math.max(1, Math.round(w * crop.width))}x${Math.max(1, Math.round(h * crop.height))}+${Math.round(w * crop.x)}+${Math.round(h * crop.y)}`,
        "+repage",
        output,
      ]);
      provenance = {
        documentId: doc.id,
        page: crop.page,
        sourceHash: doc.contentSha256,
        revision: doc.revision,
        originalObjectId: original.id,
        crop,
      };
      const annotations = (input.spec as { annotations?: unknown }).annotations;
      if (Array.isArray(annotations) && annotations.length) {
        const refs = revision.evidence as Array<{ id: string }>;
        if (!Array.isArray(refs))
          throw Error("annotations_require_structured_evidence");
        const dimensions = await exec("identify", ["-format", "%w %h", output]);
        const [width, height] = dimensions.stdout
          .trim()
          .split(/\s+/)
          .map(Number);
        const overlay = renderAnnotations(
          annotations,
          refs.map((e) => e.id),
          width,
          height,
        );
        await writeFile(path.join(scratch, "overlay.svg"), overlay);
        await exec(
          "rsvg-convert",
          [
            "-o",
            path.join(scratch, "overlay.png"),
            path.join(scratch, "overlay.svg"),
          ],
          { timeout: 60000 },
        );
        await exec(
          "convert",
          [
            output,
            path.join(scratch, "overlay.png"),
            "-compose",
            "over",
            "-composite",
            output,
          ],
          { timeout: 60000 },
        );
      }
    }
    const bytes = await readFile(output);
    if (bytes.length > 3000000) throw Error("visual_exceeds_export_size");
    const hash = fingerprint([...bytes]);
    const objectKey = `workspaces/${context.workspaceId}/article-visuals/${hash}.png`;
    await getObjectStorage().putObject({
      key: objectKey,
      body: bytes,
      contentLength: bytes.length,
      contentType: "image/png",
    });
    const masterKey = master
      ? `workspaces/${context.workspaceId}/article-visuals/${hash}.svg`
      : null;
    if (master && masterKey)
      await getObjectStorage().putObject({
        key: masterKey,
        body: Buffer.from(master),
        contentLength: Buffer.byteLength(master),
        contentType: "image/svg+xml",
      });
    await assertArticleSourcesCurrent(context, input.revisionId);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "KnowledgeArticleRevision" WHERE id = ${revision.id} FOR UPDATE`;
      const current = await tx.knowledgeArticleRevision.findUniqueOrThrow({
        where: { id: revision.id },
      });
      if (current.approval) throw Error("approved_revision_is_immutable");
      if (input.replacesId) {
        await tx.knowledgeVisual.findFirstOrThrow({
          where: {
            id: input.replacesId,
            articleRevisionId: revision.id,
            workspaceId: context.workspaceId,
          },
        });
        if (
          await tx.knowledgeVisual.count({
            where: {
              articleRevisionId: revision.id,
              provenance: { path: ["replacesId"], equals: input.replacesId },
            },
          })
        )
          throw Error("visual_already_revised");
      }
      return tx.knowledgeVisual.create({
        data: {
          workspaceId: context.workspaceId,
          articleRevisionId: revision.id,
          kind: input.kind,
          spec: json(input.spec),
          provenance: json({
            source: provenance,
            generation: input.generation,
            objectKey,
            masterKey,
            hash,
            replacesId: input.replacesId,
          }),
          caption: input.caption.trim(),
          altText: input.altText.trim(),
        },
      });
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
