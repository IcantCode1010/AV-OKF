import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeTopicRelations,
  validateTopicRelations,
  type TopicRelation,
} from "./okf-relations.ts";

type ExportTopic = {
  id: string;
  title: string;
  summary: string;
  pageStart: number;
  pageEnd: number;
  reviewStatus: string;
  relations?: TopicRelation[];
  sourcePageNumbers: number[];
};

type ExportDocument = {
  title: string;
  aircraftFamily: string | null;
  manualType: string | null;
  ata: string | null;
  effectivity: string | null;
  sourceAuthority: string | null;
  revision: string | null;
};

type RequiredDocumentMetadata = {
  aircraftFamily: string;
  manualType: string;
  ata: string;
  effectivity: string;
  sourceAuthority: string;
  revision: string;
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
  knowledgeRoot?: string;
};

const REQUIRED_DOCUMENT_METADATA = [
  "aircraftFamily",
  "manualType",
  "ata",
  "effectivity",
  "sourceAuthority",
  "revision",
] as const;

const MAX_TOPIC_SLUG_LENGTH = 80;
const TOPIC_ID_FRAGMENT_LENGTH = 10;

export function buildOkfSystemTopic(input: BuildOkfSystemTopicInput): {
  content: string;
  filename: string;
} {
  if (input.topic.reviewStatus !== "approved") {
    throw new Error("okf_export_requires_approved_topic");
  }

  const metadata = getRequiredDocumentMetadata(input.document);
  const relations = normalizeTopicRelations(input.topic.relations);

  const filename = buildFilename(metadata.ata, input.topic);
  const lastVerified = toIsoDate(input.exportedAt ?? new Date());
  const frontmatterFields: FrontmatterFields = {
    type: "system_topic",
    review_status: "approved",
    title: input.topic.title,
    description: input.topic.summary,
    aircraft_family: metadata.aircraftFamily,
    manual_type: metadata.manualType,
    ata: metadata.ata,
    effectivity: metadata.effectivity,
    source_authority: metadata.sourceAuthority,
    revision: metadata.revision,
    source_file: input.document.title,
    source_pages: input.topic.sourcePageNumbers,
    knowledge_version: input.knowledgeVersion,
    last_verified: lastVerified,
  };

  if (relations.length > 0) {
    frontmatterFields.relations = relations;
  }

  const frontmatter = stringifyFrontmatter(frontmatterFields);
  const pageRange =
    input.topic.pageStart === input.topic.pageEnd
      ? `page ${input.topic.pageStart}`
      : `pages ${input.topic.pageStart}-${input.topic.pageEnd}`;

  return {
    content: `---\n${frontmatter}---\n\n# ${input.topic.title}\n\n${input.topic.summary}\n\n## Source\n\n- ${input.document.title}, ${pageRange}\n`,
    filename,
  };
}

export function buildOkfSourceManifest(input: BuildOkfSourceManifestInput): {
  content: string;
  filename: string;
} {
  const lastVerified = toIsoDate(input.exportedAt ?? new Date());
  const frontmatter = stringifyFrontmatter({
    type: "source_manifest",
    review_status: "approved",
    title: "Source Manifest",
    description: "Approved source documents represented in this OKF bundle.",
    knowledge_version: input.knowledgeVersion,
    last_verified: lastVerified,
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
    path.join(/* turbopackIgnore: true */ process.cwd(), "knowledge");
  const relations = normalizeTopicRelations(input.topic.relations);
  if (relations.length > 0) {
    await validateTopicRelations(relations, knowledgeRoot);
  }

  const exported = buildOkfSystemTopic(input);
  const topicPath = path.join(knowledgeRoot, exported.filename);

  await mkdir(knowledgeRoot, { recursive: true });
  const isReExport = await fileExists(topicPath);
  await writeFile(topicPath, exported.content, "utf8");
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
    existing = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    existing = buildOkfSourceManifest(input).content;
  }

  const lines = existing.split(/\r?\n/);
  const filtered = removeSourceManifestEntry(lines, input.document.title);

  await writeFile(
    manifestPath,
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
    existing = await readFile(indexPath, "utf8");
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
    indexPath,
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
    existing = await readFile(logPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const base = existing.trimEnd() || "# Change Log";
  await writeFile(logPath, `${base}\n\n${entry}\n`, "utf8");
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

function getRequiredDocumentMetadata(
  document: ExportDocument,
): RequiredDocumentMetadata {
  const missing = REQUIRED_DOCUMENT_METADATA.filter((field) => {
    const value = document[field];
    return value === null || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`okf_export_missing_document_metadata: ${missing.join(", ")}`);
  }

  return {
    aircraftFamily: document.aircraftFamily!,
    manualType: document.manualType!,
    ata: document.ata!,
    effectivity: document.effectivity!,
    sourceAuthority: document.sourceAuthority!,
    revision: document.revision!,
  };
}

function formatSourceManifestEntry(document: ExportDocument) {
  const metadata = getRequiredDocumentMetadata(document);

  return [
    `- ${document.title}`,
    `  - aircraft_family: ${metadata.aircraftFamily}`,
    `  - source_authority: ${metadata.sourceAuthority}`,
    `  - manual_type: ${metadata.manualType}`,
    `  - ata: ${metadata.ata}`,
    `  - effectivity: ${metadata.effectivity}`,
    `  - revision: ${metadata.revision}`,
  ].join("\n");
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
  string | number[] | TopicRelation[]
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

function buildFilename(ata: string, topic: ExportTopic) {
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

  return `${slugify(ata)}-${cappedSlug}-${topicIdFragment}.md`;
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
    await readFile(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}
