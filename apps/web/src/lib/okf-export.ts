import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeTopicRelations,
  type TopicRelation,
} from "./okf-relation-types.ts";
import { validateTopicRelations } from "./okf-relations.ts";
import { normalizeOkfArticleBody } from "./okf-article-content.ts";

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
  coverageType?: string;
  okfMetadata?: Record<string, unknown>;
  topicType?: string;
  approvedContentSource?: string | null;
  approvalMode?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  enrichedBody?: string | null;
};

type ExportDocument = {
  title: string;
  subjectFamily: string | null;
  documentType: string | null;
  classificationCode: string | null;
  effectivity: string | null;
  sourceAuthority: string | null;
  revision: string | null;
};

type BuildOkfSystemTopicInput = {
  document: ExportDocument;
  exportedAt?: Date;
  knowledgeVersion: string;
  topic: ExportTopic;
};

type BuildOkfSourceManifestInput = {
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
  const updated = toIsoDate(input.exportedAt ?? new Date());
  const frontmatterFields: FrontmatterFields = {
    type,
    review_status: "approved",
    title: input.topic.title,
    description: input.topic.summary,
    source_file: input.document.title,
    source_pages: input.topic.sourcePageNumbers,
    knowledge_version: input.knowledgeVersion,
    updated,
  };

  if (input.topic.approvedBy) {
    frontmatterFields.approved_by = input.topic.approvalMode === "automated"
      ? `automation:${input.topic.approvedBy}`
      : input.topic.approvedBy;
  }
  if (input.topic.approvedAt) {
    frontmatterFields.approved_at = toIsoDate(new Date(input.topic.approvedAt));
  }

  addOptionalField(frontmatterFields, "subject_family", input.document.subjectFamily);
  addOptionalField(frontmatterFields, "document_type", input.document.documentType);
  addOptionalField(
    frontmatterFields,
    "classification_code",
    input.document.classificationCode,
  );
  addOptionalField(frontmatterFields, "effectivity", input.document.effectivity);
  addOptionalField(frontmatterFields, "source_authority", input.document.sourceAuthority);
  addOptionalField(frontmatterFields, "revision", input.document.revision);
  addCustomMetadata(frontmatterFields, input.topic.okfMetadata);

  if (relations.length > 0) {
    frontmatterFields.relations = relations;
  }

  if (input.topic.coveredRagChunkIds && input.topic.coveredRagChunkIds.length > 0) {
    frontmatterFields.covered_rag_chunk_ids = input.topic.coveredRagChunkIds;
    frontmatterFields.coverage_type = input.topic.coverageType ?? "direct_source";
  }

  const frontmatter = stringifyFrontmatter(frontmatterFields);
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

  return {
    content: `---\n${frontmatter}---\n\n# ${input.topic.title}\n\n${body}\n\n## Source\n\n- ${input.document.title}, ${pageRange}\n`,
    filename,
  };
}

export function buildOkfSourceManifest(input: BuildOkfSourceManifestInput): {
  content: string;
  filename: string;
} {
  const updated = toIsoDate(input.exportedAt ?? new Date());
  const frontmatter = stringifyFrontmatter({
    type: "source_manifest",
    review_status: "approved",
    title: "Source Manifest",
    description: "Approved source documents represented in this OKF bundle.",
    knowledge_version: input.knowledgeVersion,
    updated,
  });
  const entry = formatSourceManifestEntry(input.document);

  return {
    content: `---\n${frontmatter}---\n\n# Source Manifest\n\n${entry}\n`,
    filename: "source_manifest.md",
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
  if (relations.length > 0) {
    const sourceDirectory = path.posix.dirname(exported.filename);
    const emittedRelations = relations.map((relation) => ({
      ...relation,
      target: toSourceRelativeTarget(sourceDirectory, relation.target),
    }));
    exported.content = buildOkfSystemTopic({
      ...input,
      topic: { ...input.topic, relations: emittedRelations },
    }).content;
  }
  const topicPath = path.join(knowledgeRoot, exported.filename);

  await mkdir(/*turbopackIgnore: true*/ path.dirname(topicPath), { recursive: true });
  const isReExport = await fileExists(topicPath);
  await writeFile(/*turbopackIgnore: true*/ topicPath, exported.content, "utf8");
  await upsertIndexEntry({
    document: input.document,
    exported,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
    knowledgeVersion: input.knowledgeVersion,
    topic: input.topic,
  });
  await upsertSourceManifestEntry({
    document: input.document,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
    knowledgeVersion: input.knowledgeVersion,
  });
  await appendLogEntry({
    action: isReExport ? "re-export" : "export",
    exported,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
  });

  return exported;
}

async function upsertSourceManifestEntry(input: {
  document: ExportDocument;
  exportedAt: Date;
  knowledgeRoot: string;
  knowledgeVersion: string;
}) {
  const manifestPath = path.join(input.knowledgeRoot, "source_manifest.md");
  const entry = formatSourceManifestEntry(input.document);
  let existing = "";

  try {
    existing = await readFile(
      /*turbopackIgnore: true*/ manifestPath,
      "utf8",
    );
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    existing = buildOkfSourceManifest(input).content;
  }

  const lines = existing.split(/\r?\n/);
  const filtered = removeSourceManifestEntry(lines, input.document.title);

  await writeFile(
    /*turbopackIgnore: true*/ manifestPath,
    `${filtered.join("\n").trimEnd()}\n${entry}\n`,
    "utf8",
  );
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
  const normalizedFiltered = normalizeReservedIndexLines(filtered);
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
  const entry = `- ${toIsoDate(input.exportedAt)} - ${input.action} - ${input.exported.filename}`;
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ logPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const base = existing.trimEnd() || "# Change Log";
  await writeFile(
    /*turbopackIgnore: true*/ logPath,
    `${base}\n\n${entry}\n`,
    "utf8",
  );
}

function normalizeReservedIndexLines(lines: string[]) {
  if (lines[0]?.trim() !== "---") {
    return lines;
  }

  const frontmatterEnd = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );

  if (frontmatterEnd === -1) {
    return lines;
  }

  return lines.slice(frontmatterEnd + 1).filter((line, index) => {
    return index !== 0 || line.trim().length > 0;
  });
}

function formatSourceManifestEntry(document: ExportDocument) {
  return [
    `- ${document.title}`,
    ...optionalManifestMetadata(document),
  ].join("\n");
}

function toSourceRelativeTarget(sourceDirectory: string, bundleRelativeTarget: string) {
  if (sourceDirectory === ".") return bundleRelativeTarget;
  const relative = path.posix.relative(sourceDirectory, bundleRelativeTarget);
  return relative || path.posix.basename(bundleRelativeTarget);
}

function optionalManifestMetadata(document: ExportDocument): string[] {
  return [
    ["subject_family", document.subjectFamily],
    ["document_type", document.documentType],
    ["classification_code", document.classificationCode],
    ["effectivity", document.effectivity],
    ["source_authority", document.sourceAuthority],
    ["revision", document.revision],
  ].flatMap(([key, value]) =>
    value && value.trim().length > 0 ? [`  - ${key}: ${value}`] : [],
  );
}

function addOptionalField(
  fields: FrontmatterFields,
  key: string,
  value: string | null,
) {
  if (value && value.trim().length > 0) fields[key] = value.trim();
}

function addCustomMetadata(
  fields: FrontmatterFields,
  metadata: Record<string, unknown> | undefined,
) {
  if (!metadata) return;

  const protectedFields = new Set([
    "type",
    "title",
    "description",
    "updated",
    "review_status",
    "source_file",
    "source_pages",
    "source_authority",
    "knowledge_version",
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

function removeSourceManifestEntry(lines: string[], title: string) {
  const entryStart = `- ${title}`;
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line.trim() !== entryStart) {
      result.push(line);
      continue;
    }

    while (index + 1 < lines.length && lines[index + 1]!.startsWith("  - ")) {
      index += 1;
    }
  }

  return result;
}

type FrontmatterFields = Record<
  string,
  string | number[] | string[] | TopicRelation[]
>;

function stringifyFrontmatter(fields: FrontmatterFields) {
  return Object.entries(fields)
    .map(([key, value]) => {
      if (isTopicRelationArray(value)) {
        return `${key}:\n${value.map(formatRelationFrontmatter).join("")}`;
      }

      if (Array.isArray(value)) {
        return `${key}:\n${value.map((item) => `  - ${item}`).join("\n")}\n`;
      }

      return `${key}: ${quoteYamlString(String(value))}\n`;
    })
    .join("");
}

function isTopicRelationArray(
  value: FrontmatterFields[string],
): value is TopicRelation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "relation" in item &&
        "target" in item,
    )
  );
}

function formatRelationFrontmatter(relation: TopicRelation) {
  return [
    `  - relation: ${quoteYamlString(relation.relation)}`,
    `    target: ${quoteYamlString(relation.target)}`,
    `    target_type: ${quoteYamlString(relation.targetType ?? "")}`,
    `    reason: ${quoteYamlString(relation.reason)}`,
  ].join("\n") + "\n";
}

function quoteYamlString(value: string) {
  return JSON.stringify(value);
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
