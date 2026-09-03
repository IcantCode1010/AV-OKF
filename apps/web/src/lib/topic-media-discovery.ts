import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { generateText, Output } from "ai";
import { z } from "zod";

import { getKnowledgeBundleByIdentity } from "./knowledge-bundles.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, getSdkModel } from "./llm-providers.ts";
import { getPrisma } from "./prisma.ts";
import {
  getObjectStorage,
  streamObjectToFile,
  type ObjectStorage,
} from "./production-storage.ts";

const execFileAsync = promisify(execFile);
const MEDIA_PROMPT_VERSION = "topic-figures-v1";
const MAX_FIGURES_PER_PAGE = 10;
const AUTO_APPROVE_MINIMUM = 0.95;
const AUTO_APPROVE_MARGIN = 0.15;

const boundingBoxSchema = z.object({
  height: z.number().min(0.01).max(1),
  width: z.number().min(0.01).max(1),
  x: z.number().min(0).max(0.99),
  y: z.number().min(0).max(0.99),
});

const topicLinkSchema = z.object({
  anchorTerms: z.array(z.string()).max(12),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  role: z.enum(["primary_evidence", "supporting_detail", "reference_diagram"]),
  topicId: z.string(),
});

export const pageFigureAnalysisSchema = z.object({
  figures: z.array(z.object({
    altText: z.string(),
    boundingBox: boundingBoxSchema,
    kind: z.enum(["figure", "diagram"]),
    sourceCaption: z.string().nullable(),
    topicLinks: z.array(topicLinkSchema),
    visibleLabels: z.array(z.string()).max(30),
    visualContext: z.string(),
  })).max(MAX_FIGURES_PER_PAGE),
  warnings: z.array(z.string()).max(20),
});

export type PageFigureAnalysis = z.infer<typeof pageFigureAnalysisSchema>;

type CandidatePage = {
  figureCaptionHints: string[];
  id: string;
  imageCount: number;
  pageNumber: number;
  text: string;
  visualCandidate: boolean;
};

type CandidateTopic = {
  id: string;
  sourcePageNumbers: number[];
  summary: string;
  title: string;
};

export function selectMediaCandidatePages(pages: CandidatePage[]) {
  return pages.filter((page) =>
    page.visualCandidate || page.imageCount > 0 || page.figureCaptionHints.length > 0
  );
}

export function buildFigureMediaPrompt(input: {
  captionHints: string[];
  pageNumber: number;
  pageText: string;
  topics: CandidateTopic[];
}) {
  return [
    `Analyze source page ${input.pageNumber} for technical figures and diagrams.`,
    `Return at most ${MAX_FIGURES_PER_PAGE} distinct visuals. Bounding boxes must be normalized to the full page from 0 to 1.`,
    "Use only the supplied topic IDs. Do not invent a topic, link, label, caption, or source.",
    "Associate a visual only when the page evidence directly supports the topic. Keep visibleLabels verbatim and concise.",
    "The visualContext must explain what the image contributes to the topic, not merely restate its appearance.",
    "Caption hints:",
    input.captionHints.length ? input.captionHints.join("\n") : "(none)",
    "Page text:",
    input.pageText.slice(0, 24_000),
    "Known topics on this exact source page:",
    JSON.stringify(input.topics.map((topic) => ({
      id: topic.id,
      summary: topic.summary,
      title: topic.title,
    }))),
  ].join("\n\n");
}

export function shouldAutoApproveTopicMedia(input: {
  anchorTerms: string[];
  confidence: number;
  enabled: boolean;
  figureWarnings: string[];
  labelsSupported: boolean;
  nextConfidence: number;
  sourcePageMatches: boolean;
  sourceText: string;
  threshold: number;
}) {
  const threshold = Math.max(AUTO_APPROVE_MINIMUM, input.threshold);
  const normalizedText = normalizeEvidenceText(input.sourceText);
  const hasDeterministicAnchor = input.anchorTerms.some((term) => {
    const normalizedTerm = normalizeEvidenceText(term);
    return normalizedTerm.length >= 3 && normalizedText.includes(normalizedTerm);
  });
  return input.enabled &&
    input.confidence >= threshold &&
    input.confidence - input.nextConfidence >= AUTO_APPROVE_MARGIN &&
    input.sourcePageMatches &&
    hasDeterministicAnchor &&
    input.labelsSupported &&
    input.figureWarnings.length === 0;
}

export async function runDocumentMediaDiscovery(input: {
  documentId: string;
  runId: string;
  workspaceId: string;
  storage?: ObjectStorage;
}) {
  const db = getPrisma();
  const document = await db.document.findFirst({
    include: { extractedPages: { orderBy: { pageNumber: "asc" } } },
    where: { deletedAt: null, id: input.documentId, workspaceId: input.workspaceId },
  });
  if (!document?.knowledgeBundleId) {
    return { assets: 0, autoApproved: 0, pendingReview: 0, warnings: ["media_document_unavailable"] };
  }
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: document.knowledgeBundleId,
    workspaceId: input.workspaceId,
  });
  if (!bundle?.profile.media.topicFiguresEnabled) {
    return { assets: 0, autoApproved: 0, pendingReview: 0, warnings: [] };
  }
  const key = await getWorkspaceLlmApiKeyForEnrichment(input.workspaceId);
  if (!key) {
    return { assets: 0, autoApproved: 0, pendingReview: 0, warnings: ["media_provider_unavailable"] };
  }
  const original = await db.documentObject.findFirst({
    orderBy: { createdAt: "asc" },
    where: { documentId: document.id, kind: "original_pdf", workspaceId: input.workspaceId },
  });
  if (!original) {
    return { assets: 0, autoApproved: 0, pendingReview: 0, warnings: ["media_source_pdf_missing"] };
  }

  const pages = selectMediaCandidatePages(document.extractedPages.map((page) => ({
    figureCaptionHints: page.figureCaptionHints,
    id: page.id,
    imageCount: page.imageCount,
    pageNumber: page.pageNumber,
    text: page.text,
    visualCandidate: page.visualCandidate,
  })));
  if (pages.length === 0) {
    return { assets: 0, autoApproved: 0, pendingReview: 0, warnings: [] };
  }
  const topics = await db.topicRecord.findMany({
    select: { id: true, sourcePageNumbers: true, summary: true, title: true },
    where: { documentId: document.id, workspaceId: input.workspaceId },
  });
  const storage = input.storage ?? getObjectStorage();
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-media-"));
  const pdfPath = path.join(scratch, "source.pdf");
  let assets = 0;
  let autoApproved = 0;
  let pendingReview = 0;
  const warnings: string[] = [];

  try {
    await streamObjectToFile({
      destination: pdfPath,
      key: original.objectKey,
      storage,
    });
    for (const page of pages) {
      const pageTopics = topics.filter((topic) => topic.sourcePageNumbers.includes(page.pageNumber));
      if (pageTopics.length === 0) continue;
      const prompt = buildFigureMediaPrompt({
        captionHints: page.figureCaptionHints,
        pageNumber: page.pageNumber,
        pageText: page.text,
        topics: pageTopics,
      });
      const inputHash = createHash("sha256")
        .update(document.contentSha256 ?? "")
        .update(String(page.pageNumber))
        .update(prompt)
        .digest("hex");
      const completedAudit = await db.mediaAnalysisAudit.findFirst({
        where: { documentId: document.id, inputHash, succeeded: true },
      });
      if (completedAudit) continue;

      try {
        const pageImage = await renderPdfPage(pdfPath, page.pageNumber, scratch);
        const provider = getLlmProvider(key.provider);
        const analysis = await analyzePageFigureMedia({
          apiKey: key.apiKey,
          image: pageImage.buffer,
          model: provider.model,
          prompt,
          provider: key.provider,
        });
        const knownTopicIds = new Set(pageTopics.map((topic) => topic.id));
        const cleanAnalysis = {
          ...analysis,
          figures: analysis.figures.map((figure) => ({
            ...figure,
            topicLinks: figure.topicLinks.filter((link) => knownTopicIds.has(link.topicId)),
          })),
        };

        for (const [figureIndex, figure] of cleanAnalysis.figures.entries()) {
          const crop = await cropFigure({
            boundingBox: figure.boundingBox,
            figureIndex,
            height: pageImage.height,
            pageImagePath: pageImage.path,
            scratch,
            width: pageImage.width,
          });
          const cropHash = createHash("sha256").update(crop.buffer).digest("hex");
          const boxHash = createHash("sha256")
            .update(JSON.stringify(figure.boundingBox))
            .digest("hex")
            .slice(0, 12);
          const objectKey = `workspaces/${input.workspaceId}/documents/${document.id}/derived/media/page-${page.pageNumber}-${boxHash}.png`;
          await storage.putObject({
            body: crop.buffer,
            contentLength: crop.buffer.length,
            contentType: "image/png",
            key: objectKey,
          });
          const cropOcr = await readCropOcr(crop.path);
          const asset = await db.documentMediaAsset.upsert({
            create: {
              altText: figure.altText.trim(),
              analysisModel: provider.model,
              analysisProvider: key.provider,
              boundingBox: figure.boundingBox,
              contentSha256: cropHash,
              documentId: document.id,
              extractedPageId: page.id,
              height: crop.height,
              kind: figure.kind,
              knowledgeBundleId: document.knowledgeBundleId,
              mimeType: "image/png",
              objectKey,
              ocrText: cropOcr,
              pageNumber: page.pageNumber,
              sourceCaption: figure.sourceCaption?.trim() || null,
              sourceDocumentSha256: document.contentSha256,
              visibleLabels: cleanStrings(figure.visibleLabels),
              visualContext: figure.visualContext.trim(),
              warningCodes: cleanAnalysis.warnings,
              width: crop.width,
              workspaceId: input.workspaceId,
            },
            update: {
              altText: figure.altText.trim(),
              analysisModel: provider.model,
              analysisProvider: key.provider,
              boundingBox: figure.boundingBox,
              contentSha256: cropHash,
              height: crop.height,
              kind: figure.kind,
              ocrText: cropOcr,
              sourceCaption: figure.sourceCaption?.trim() || null,
              sourceDocumentSha256: document.contentSha256,
              visibleLabels: cleanStrings(figure.visibleLabels),
              visualContext: figure.visualContext.trim(),
              warningCodes: cleanAnalysis.warnings,
              width: crop.width,
            },
            where: { objectKey },
          });
          assets += 1;
          const rankedLinks = [...figure.topicLinks].sort((left, right) => right.confidence - left.confidence);
          for (const [linkIndex, link] of rankedLinks.entries()) {
            const labelsSupported = figure.visibleLabels.every((label) =>
              normalizeEvidenceText(`${cropOcr} ${page.text}`).includes(normalizeEvidenceText(label))
            );
            const status = linkIndex === 0 && shouldAutoApproveTopicMedia({
              anchorTerms: link.anchorTerms,
              confidence: link.confidence,
              enabled: bundle.profile.media.autoApproveHighConfidenceEnabled,
              figureWarnings: cleanAnalysis.warnings,
              labelsSupported,
              nextConfidence: rankedLinks[1]?.confidence ?? 0,
              sourcePageMatches: pageTopics.some((topic) => topic.id === link.topicId),
              sourceText: `${page.text}\n${figure.sourceCaption ?? ""}\n${cropOcr}`,
              threshold: bundle.profile.media.autoApproveThreshold,
            }) ? "auto_approved" : "pending_review";
            await db.topicMediaReference.upsert({
              create: {
                anchorTerms: cleanStrings(link.anchorTerms),
                confidence: link.confidence,
                documentId: document.id,
                knowledgeBundleId: document.knowledgeBundleId,
                mediaAssetId: asset.id,
                rationale: link.rationale.trim(),
                role: link.role,
                status,
                topicId: link.topicId,
                workspaceId: input.workspaceId,
              },
              update: {
                anchorTerms: cleanStrings(link.anchorTerms),
                confidence: link.confidence,
                rationale: link.rationale.trim(),
                role: link.role,
                status,
              },
              where: { topicId_mediaAssetId: { mediaAssetId: asset.id, topicId: link.topicId } },
            });
            if (status === "auto_approved") autoApproved += 1;
            else pendingReview += 1;
          }
        }
        await db.mediaAnalysisAudit.create({
          data: {
            documentId: document.id,
            extractedPageId: page.id,
            inputHash,
            model: provider.model,
            pageNumber: page.pageNumber,
            promptVersion: MEDIA_PROMPT_VERSION,
            provider: key.provider,
            structuredOutput: cleanAnalysis,
            succeeded: true,
            warningCodes: cleanAnalysis.warnings,
            workspaceId: input.workspaceId,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`page_${page.pageNumber}:${message}`);
        await db.mediaAnalysisAudit.create({
          data: {
            documentId: document.id,
            extractedPageId: page.id,
            errorMessage: message,
            inputHash,
            model: getLlmProvider(key.provider).model,
            pageNumber: page.pageNumber,
            promptVersion: MEDIA_PROMPT_VERSION,
            provider: key.provider,
            succeeded: false,
            warningCodes: ["media_page_analysis_failed"],
            workspaceId: input.workspaceId,
          },
        });
      }
    }
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
  return { assets, autoApproved, pendingReview, warnings };
}

export async function loadApprovedTopicMediaForEnrichment(input: {
  storage?: ObjectStorage;
  topicId: string;
  workspaceId: string;
}) {
  const db = getPrisma();
  const references = await db.topicMediaReference.findMany({
    include: { mediaAsset: true, document: { select: { contentSha256: true } } },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    take: 5,
    where: {
      status: { in: ["approved", "auto_approved"] },
      topicId: input.topicId,
      workspaceId: input.workspaceId,
    },
  });
  const storage = input.storage ?? getObjectStorage();
  const media: Array<{
    altText: string;
    image: Buffer;
    pageNumber: number;
    sourceCaption: string | null;
    visualContext: string;
  }> = [];
  for (const reference of references) {
    if (
      !reference.document.contentSha256 ||
      reference.mediaAsset.sourceDocumentSha256 !== reference.document.contentSha256
    ) {
      await db.topicMediaReference.update({
        data: { status: "stale" },
        where: { id: reference.id },
      });
      continue;
    }
    try {
      media.push({
        altText: reference.mediaAsset.altText,
        image: await storage.getObject(reference.mediaAsset.objectKey),
        pageNumber: reference.mediaAsset.pageNumber,
        sourceCaption: reference.mediaAsset.sourceCaption,
        visualContext: reference.mediaAsset.visualContext,
      });
    } catch {
      continue;
    }
  }
  return media;
}

async function analyzePageFigureMedia(input: {
  apiKey: string;
  image: Buffer;
  model: string;
  prompt: string;
  provider: "anthropic" | "kimi" | "openai";
}) {
  const result = await generateText({
    maxOutputTokens: 5_000,
    messages: [{
      content: [
        { type: "text", text: input.prompt },
        { type: "image", image: input.image, mediaType: "image/png" },
      ],
      role: "user",
    }],
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: pageFigureAnalysisSchema }),
    providerOptions: input.provider === "kimi"
      ? { openai: { reasoningEffort: "high" } }
      : undefined,
    system: "You extract source-grounded technical figures for a reviewable aviation knowledge bundle. Return only the requested structured object.",
    temperature: 0,
  });
  return result.output;
}

async function renderPdfPage(pdfPath: string, pageNumber: number, scratch: string) {
  const rawPrefix = path.join(scratch, `page-${pageNumber}-raw`);
  const outputPath = path.join(scratch, `page-${pageNumber}.png`);
  await execFileAsync("pdftoppm", [
    "-f", String(pageNumber), "-l", String(pageNumber), "-r", "300", "-png", "-singlefile", pdfPath, rawPrefix,
  ], { maxBuffer: 10 * 1024 * 1024 });
  await execFileAsync("convert", [`${rawPrefix}.png`, "-resize", "4096x4096>", outputPath]);
  const { stdout } = await execFileAsync("identify", ["-format", "%w %h", outputPath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("media_page_dimensions_invalid");
  return { buffer: await readFile(outputPath), height, path: outputPath, width };
}

async function cropFigure(input: {
  boundingBox: z.infer<typeof boundingBoxSchema>;
  figureIndex: number;
  height: number;
  pageImagePath: string;
  scratch: string;
  width: number;
}) {
  const padding = 12;
  const x = Math.max(0, Math.floor(input.boundingBox.x * input.width) - padding);
  const y = Math.max(0, Math.floor(input.boundingBox.y * input.height) - padding);
  const width = Math.min(input.width - x, Math.ceil(input.boundingBox.width * input.width) + padding * 2);
  const height = Math.min(input.height - y, Math.ceil(input.boundingBox.height * input.height) + padding * 2);
  if (width < 32 || height < 32) throw new Error("media_figure_bounding_box_too_small");
  const outputPath = path.join(input.scratch, `figure-${input.figureIndex}.png`);
  await execFileAsync("convert", [input.pageImagePath, "-crop", `${width}x${height}+${x}+${y}`, "+repage", outputPath]);
  return { buffer: await readFile(outputPath), height, path: outputPath, width };
}

async function readCropOcr(imagePath: string) {
  try {
    const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "11"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function cleanStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEvidenceText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
