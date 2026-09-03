import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeTopicRelations,
  type TopicRelation,
} from "./okf-relation-types.ts";
import { validateTopicRelations } from "./okf-relations.ts";
import { normalizeOkfArticleBody } from "./okf-article-content.ts";
import {
  serializeOkfMarkdown,
  type OkfActorEvent,
  type OkfSource,
  type OkfV02Frontmatter,
} from "./okf-frontmatter.ts";

type ExportTopic = {
  id: string;
  title: string;
  summary: string;
  pageStart: number;
  pageEnd: number;
  reviewStatus: string;
  relations?: TopicRelation[];
  sourcePageNumbers: number[];
  coveredRagChunkIds?: string[];
  portableCitations?: Array<{
    chunks: Array<{ id: string; pages: number[] }>;
    source: string;
  }>;
  coverageType?: string;
  okfMetadata?: Record<string, unknown>;
  topicType?: string;
  approvedContentSource?: string | null;
  approvalMode?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  enrichedBody?: string | null;
  media?: ExportTopicMedia[];
};

export type ExportTopicMedia = {
  altText: string;
  kind: "diagram" | "figure";
  pageNumber: number;
  resourcePath: string;
  sourceCaption: string | null;
  visualContext: string;
};

type ExportDocument = {
  aircraftFamily?: string | null;
  ata?: string | null;
  contentSha256: string | null;
  title: string;
  subjectFamily: string | null;
  documentType: string | null;
  classificationCode: string | null;
  effectivity: string | null;
  sourceAuthority: string | null;
  revision: string | null;
  mimeType: string;
  manualType?: string | null;
  originalFilename: string | null;
  sizeBytes: number;
};

type BuildOkfSystemTopicInput = {
  document: ExportDocument;
  exportedAt?: Date;
  knowledgeVersion: string;
  topic: ExportTopic;
  topicFilePath?: string;
};

type BuildOkfSourceReferenceInput = {
  document: ExportDocument;
  exportedAt?: Date;
  knowledgeVersion: string;
};

type ExportTopicToKnowledgeInput = BuildOkfSystemTopicInput & {
  directory?: string;
  knowledgeRoot?: string;
};

const MAX_TOPIC_SLUG_LENGTH = 80;
const TOPIC_ID_FRAGMENT_LENGTH = 10;

export function buildOkfSystemTopic(input: BuildOkfSystemTopicInput): {
  content: string;
  filename: string;
} {
  if (input.topic.reviewStatus !== "approved") {
    throw new Error("okf_export_requires_approved_topic");
  }

  const relations = normalizeTopicRelations(input.topic.relations);

  const type = normalizeConceptType(
    typeof input.topic.okfMetadata?.type === "string"
      ? input.topic.okfMetadata.type
      : "system_topic",
  );
  const filename = buildFilename(
    input.document.classificationCode ?? type,
    input.topic,
  );
  const exportedAt = input.exportedAt ?? new Date();
  const source = buildSourceReferenceIdentity(input.document);
  validatePortableCitations(input.topic.portableCitations ?? [], source.id, source.digest, input.topic.sourcePageNumbers);
  const verification = buildVerificationEvent(input.topic, exportedAt);
  const frontmatterFields: OkfV02Frontmatter = {
    type,
    title: input.topic.title,
    description: input.topic.summary,
    status: "stable",
    generated: {
      by: input.topic.approvedContentSource === "enriched"
        ? "av-okf/enrichment"
        : actorForHumanOrProcess(input.topic.approvedBy),
      at: exportedAt.toISOString(),
    },
    verified: [verification],
    sources: [{
      id: source.id,
      resource: `/${source.filePath}`,
      title: input.document.title,
    } satisfies OkfSource],
    source_pages: input.topic.sourcePageNumbers,
    knowledge_version: input.knowledgeVersion,
    av_okf_approval_mode: normalizeApprovalMode(input.topic.approvalMode),
  };

  addOptionalField(frontmatterFields, "subject_family", input.document.subjectFamily);
  addOptionalField(frontmatterFields, "document_type", input.document.documentType);
  addOptionalField(
    frontmatterFields,
    "classification_code",
    input.document.classificationCode,
  );
  addOptionalField(frontmatterFields, "effectivity", input.document.effectivity);
  addOptionalField(frontmatterFields, "revision", input.document.revision);
  addOptionalField(frontmatterFields, "aircraft_family", input.document.aircraftFamily);
  addOptionalField(frontmatterFields, "ata", input.document.ata);
  addOptionalField(frontmatterFields, "manual_type", input.document.manualType);
  addOptionalField(frontmatterFields, "source_authority", input.document.sourceAuthority);
  addCustomMetadata(frontmatterFields, input.topic.okfMetadata);
  if (input.topic.media?.length) {
    frontmatterFields.av_okf_media = input.topic.media.map((media) => ({
      alt: media.altText,
      av_okf_kind: media.kind,
      context: media.visualContext,
      page: media.pageNumber,
      resource: `/${media.resourcePath}`,
      ...(media.sourceCaption ? { caption: media.sourceCaption } : {}),
    }));
  }

  if (relations.length > 0) {
    frontmatterFields.relations = relations.map((relation) => ({
      relation: relation.relation,
      target: relation.target,
      ...(relation.targetType ? { target_type: relation.targetType } : {}),
      reason: relation.reason,
      ...(relation.approvalMode
        ? { av_okf_approval_mode: relation.approvalMode }
        : {}),
      ...(typeof relation.verificationConfidence === "number"
        ? { verification_confidence: relation.verificationConfidence }
        : {}),
    }));
  }

  if (input.topic.portableCitations && input.topic.portableCitations.length > 0) {
    frontmatterFields.av_okf_citations = input.topic.portableCitations;
    frontmatterFields.coverage_type = input.topic.coverageType ?? "direct_source";
  }

  const pageRange =
    input.topic.pageStart === input.topic.pageEnd
      ? `page ${input.topic.pageStart}`
      : `pages ${input.topic.pageStart}-${input.topic.pageEnd}`;
  const rawBody =
    input.topic.approvedContentSource === "enriched" && input.topic.enrichedBody
      ? input.topic.enrichedBody
      : input.topic.summary;
  const body = normalizeOkfArticleBody({
    body: rawBody,
    title: input.topic.title,
  }).body || input.topic.summary;

  const relationBody = relations.length > 0
    ? `\n\n## Relations\n\n${relations.map((relation) =>
        `- [${relation.relation}](${relation.target}) - ${relation.reason}`,
      ).join("\n")}`
    : "";
  const figureBody = input.topic.media?.length
    ? `\n\n## Figures\n\n${input.topic.media.map((media) => {
        const relativePath = path.posix.relative(
          path.posix.dirname(input.topicFilePath ?? filename),
          media.resourcePath,
        );
        const caption = media.sourceCaption ?? media.visualContext;
        return `![${media.altText}](${relativePath})\n\n*${caption} (source page ${media.pageNumber})*`;
      }).join("\n\n")}`
    : "";
  const articleBody = `# ${input.topic.title}\n\n${body}${figureBody}${relationBody}\n\n## Source\n\n- ${input.document.title}, ${pageRange}`;

  return {
    content: serializeOkfMarkdown({ body: articleBody, frontmatter: frontmatterFields }),
    filename,
  };
}

export function buildOkfSourceReference(input: BuildOkfSourceReferenceInput): {
  content: string;
  filename: string;
} {
  const exportedAt = input.exportedAt ?? new Date();
  const source = buildSourceReferenceIdentity(input.document);
  const frontmatter: OkfV02Frontmatter = {
    type: "reference",
    title: input.document.title,
    description: "Source document represented by approved concepts in this bundle.",
    resource: `urn:sha256:${source.digest}`,
    tags: ["source-document"],
    status: "stable",
    generated: {
      by: "process:av-okf-source-ingestion",
      at: exportedAt.toISOString(),
    },
    av_okf_role: "source_document",
    content_sha256: source.digest,
    media_type: input.document.mimeType,
    original_filename: input.document.originalFilename ?? input.document.title,
    size_bytes: input.document.sizeBytes,
    knowledge_version: input.knowledgeVersion,
  };
  addOptionalField(frontmatter, "revision", input.document.revision);
  addOptionalField(frontmatter, "source_authority", input.document.sourceAuthority);

  return {
    content: serializeOkfMarkdown({
      body: `# ${input.document.title}\n\nPortable source identity for the uploaded PDF.`,
      frontmatter,
    }),
    filename: source.filePath,
  };
}

export async function exportTopicToKnowledge(
  input: ExportTopicToKnowledgeInput,
): Promise<{ content: string; filename: string }> {
  const knowledgeRoot =
    input.knowledgeRoot ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), "knowledge");
  const relations = normalizeTopicRelations(input.topic.relations);
  if (relations.length > 0) {
    await validateTopicRelations(relations, knowledgeRoot);
  }

  const initial = buildOkfSystemTopic(input);
  const exported = {
    ...initial,
    filename: input.directory
      ? path.posix.join(input.directory, initial.filename)
      : initial.filename,
  };
  const sourceDirectory = path.posix.dirname(exported.filename);
  const emittedRelations = relations.map((relation) => ({
    ...relation,
    target: toSourceRelativeTarget(sourceDirectory, relation.target),
  }));
  exported.content = buildOkfSystemTopic({
    ...input,
    topic: { ...input.topic, relations: emittedRelations },
    topicFilePath: exported.filename,
  }).content;
  const topicPath = path.join(knowledgeRoot, exported.filename);
  const sourceReference = buildOkfSourceReference(input);
  const sourcePath = path.join(knowledgeRoot, sourceReference.filename);

  await mkdir(/*turbopackIgnore: true*/ path.dirname(topicPath), { recursive: true });
  await mkdir(/*turbopackIgnore: true*/ path.dirname(sourcePath), { recursive: true });
  const isReExport = await fileExists(topicPath);
  await writeFile(/*turbopackIgnore: true*/ sourcePath, sourceReference.content, "utf8");
  await writeFile(/*turbopackIgnore: true*/ topicPath, exported.content, "utf8");
  await upsertIndexEntry({
    document: input.document,
    exported,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
    knowledgeVersion: input.knowledgeVersion,
    topic: input.topic,
  });
  await appendLogEntry({
    action: isReExport ? "re-export" : "export",
    exported,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
  });

  return exported;
}

async function upsertIndexEntry(input: {
  document: ExportDocument;
  exported: { filename: string };
  exportedAt: Date;
  knowledgeRoot: string;
  knowledgeVersion: string;
  topic: ExportTopic;
}) {
  const indexPath = path.join(input.knowledgeRoot, "index.md");
  const entry = `- [${input.topic.title}](${input.exported.filename}) - ${input.topic.summary}`;
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ indexPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    existing = createIndexFile();
  }

  const lines = existing.split(/\r?\n/);
  const filtered = lines.filter(
    (line) => !line.includes(`](${input.exported.filename})`),
  );
  const normalizedFiltered = filtered;
  const insertionIndex = normalizedFiltered.findIndex(
    (line) => line.trim() === "",
  );

  if (insertionIndex === -1) {
    normalizedFiltered.push("", entry);
  } else {
    normalizedFiltered.splice(insertionIndex, 0, entry);
  }

  await writeFile(
    /*turbopackIgnore: true*/ indexPath,
    `${normalizedFiltered.join("\n").trimEnd()}\n`,
    "utf8",
  );
}

function createIndexFile() {
  return [
    "---",
    'okf_version: "0.2"',
    "---",
    "",
    "# AV-OKF Knowledge Bundle",
    "",
    "This directory is the OKF bundle root.",
    "",
    "Approved OKF concepts are exported here after topic review. Raw extraction and unreviewed RAG content should not be committed here as trusted OKF.",
    "",
  ].join("\n");
}

async function appendLogEntry(input: {
  action: "export" | "re-export";
  exported: { filename: string };
  exportedAt: Date;
  knowledgeRoot: string;
}) {
  const logPath = path.join(input.knowledgeRoot, "log.md");
  const day = toIsoDate(input.exportedAt);
  const entry = `- **${input.action === "export" ? "Creation" : "Update"}**: ${input.exported.filename}`;
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ logPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const base = existing.trimEnd() || "# Change Log";
  const heading = `## ${day}`;
  const next = base.includes(heading)
    ? base.replace(heading, `${heading}\n${entry}`)
    : `${base.split(/\r?\n/)[0] ?? "# Change Log"}\n\n${heading}\n${entry}\n\n${base.split(/\r?\n/).slice(1).join("\n").trim()}`.trimEnd();
  await writeFile(
    /*turbopackIgnore: true*/ logPath,
    `${next}\n`,
    "utf8",
  );
}

function toSourceRelativeTarget(sourceDirectory: string, bundleRelativeTarget: string) {
  if (sourceDirectory === ".") return bundleRelativeTarget;
  const relative = path.posix.relative(sourceDirectory, bundleRelativeTarget);
  return relative || path.posix.basename(bundleRelativeTarget);
}

function addOptionalField(
  fields: OkfV02Frontmatter,
  key: string,
  value: string | null | undefined,
) {
  if (value && value.trim().length > 0) fields[key] = value.trim();
}

function addCustomMetadata(
  fields: OkfV02Frontmatter,
  metadata: Record<string, unknown> | undefined,
) {
  if (!metadata) return;

  const protectedFields = new Set([
    "type",
    "title",
    "description",
    "resource",
    "tags",
    "sources",
    "generated",
    "verified",
    "status",
    "stale_after",
    "source_pages",
    "knowledge_version",
    "av_okf_approval_mode",
    "av_okf_citations",
    "relations",
  ]);
  for (const [key, value] of Object.entries(metadata)) {
    if (protectedFields.has(key)) continue;
    if (typeof value === "string" && value.trim().length > 0) {
      fields[key] = value.trim();
    } else if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string" && item.trim().length > 0)
    ) {
      fields[key] = value.map((item) => item.trim());
    }
  }
}

function normalizeConceptType(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new Error("okf_export_invalid_type");
  }
  return normalized;
}

function buildVerificationEvent(topic: ExportTopic, fallback: Date): OkfActorEvent {
  const at = topic.approvedAt && !Number.isNaN(new Date(topic.approvedAt).valueOf())
    ? new Date(topic.approvedAt).toISOString()
    : fallback.toISOString();
  if (topic.approvalMode === "automated") {
    return { at, by: "process:av-okf-auto-approval" };
  }
  if (!topic.approvalMode) {
    return { at, by: "process:av-okf-v0.1-migration" };
  }
  return { at, by: actorForHumanOrProcess(topic.approvedBy) };
}

function actorForHumanOrProcess(actor: string | null | undefined): string {
  if (!actor) return "process:av-okf";
  if (actor.startsWith("human:") || actor.startsWith("process:")) return actor;
  return `human:${actor}`;
}

function normalizeApprovalMode(mode: string | null | undefined): string {
  return mode || "legacy";
}

function buildSourceReferenceIdentity(document: ExportDocument) {
  const digest = document.contentSha256?.trim().toLowerCase();
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("okf_export_requires_source_hash");
  }
  return {
    digest,
    // The path is content-addressed so duplicate PDFs deduplicate even when
    // workspace titles or uploaded filenames differ.
    filePath: `references/sources/source-document-${digest.slice(0, 12)}.md`,
    id: `source-${digest.slice(0, 12)}`,
  };
}

function validatePortableCitations(
  citations: NonNullable<ExportTopic["portableCitations"]>,
  sourceId: string,
  sourceDigest: string,
  sourcePages: number[],
) {
  const allowedPages = new Set(sourcePages);
  for (const citation of citations) {
    if (citation.source !== sourceId) throw new Error("okf_citation_source_mismatch");
    for (const chunk of citation.chunks) {
      if (!chunk.id.startsWith(`avchunk:${sourceDigest}:`) || !/^avchunk:[a-f0-9]{64}:[a-f0-9]{64}$/.test(chunk.id)) {
        throw new Error("okf_citation_chunk_id_invalid");
      }
      if (!chunk.pages.length || chunk.pages.some((page) => !Number.isInteger(page) || page < 1 || !allowedPages.has(page))) {
        throw new Error("okf_citation_pages_invalid");
      }
    }
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFilename(classificationCode: string, topic: ExportTopic) {
  if (!topic.id) {
    throw new Error("okf_export_requires_topic_id");
  }

  const titleSlug = slugify(topic.title);
  if (!titleSlug) {
    throw new Error("okf_export_invalid_title: title produces empty slug");
  }

  const cappedSlug = capSlug(titleSlug, MAX_TOPIC_SLUG_LENGTH);
  const topicIdFragment = createHash("sha256")
    .update(topic.id)
    .digest("hex")
    .slice(0, TOPIC_ID_FRAGMENT_LENGTH);

  return `${slugify(classificationCode)}-${cappedSlug}-${topicIdFragment}.md`;
}

function capSlug(slug: string, maxLength: number) {
  if (slug.length <= maxLength) {
    return slug;
  }

  const truncated = slug.slice(0, maxLength).replace(/-+$/g, "");
  const lastHyphen = truncated.lastIndexOf("-");

  if (lastHyphen > 0) {
    return truncated.slice(0, lastHyphen).replace(/-+$/g, "");
  }

  return truncated;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isMissingFileError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT";
}

async function fileExists(filePath: string) {
  try {
    await readFile(/*turbopackIgnore: true*/ filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}
