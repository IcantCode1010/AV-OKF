import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ExportTopic = {
  id: string;
  title: string;
  summary: string;
  pageStart: number;
  pageEnd: number;
  reviewStatus: string;
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
const TOPIC_ID_FRAGMENT_LENGTH = 8;

export function buildOkfSystemTopic(input: BuildOkfSystemTopicInput): {
  content: string;
  filename: string;
} {
  if (input.topic.reviewStatus !== "approved") {
    throw new Error("okf_export_requires_approved_topic");
  }

  const metadata = getRequiredDocumentMetadata(input.document);

  const filename = buildFilename(metadata.ata, input.topic);
  const lastVerified = toIsoDate(input.exportedAt ?? new Date());
  const frontmatter = stringifyFrontmatter({
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
  });
  const pageRange =
    input.topic.pageStart === input.topic.pageEnd
      ? `page ${input.topic.pageStart}`
      : `pages ${input.topic.pageStart}-${input.topic.pageEnd}`;

  return {
    content: `---\n${frontmatter}---\n\n# ${input.topic.title}\n\n${input.topic.summary}\n\n## Source\n\n- ${input.document.title}, ${pageRange}\n`,
    filename,
  };
}

export async function exportTopicToKnowledge(
  input: ExportTopicToKnowledgeInput,
): Promise<{ content: string; filename: string }> {
  const knowledgeRoot =
    input.knowledgeRoot ?? path.join(process.cwd(), "knowledge");
  const exported = buildOkfSystemTopic(input);

  await mkdir(knowledgeRoot, { recursive: true });
  await writeFile(
    path.join(knowledgeRoot, exported.filename),
    exported.content,
    "utf8",
  );
  await upsertIndexEntry({
    document: input.document,
    exported,
    exportedAt: input.exportedAt ?? new Date(),
    knowledgeRoot,
    knowledgeVersion: input.knowledgeVersion,
    topic: input.topic,
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
    existing = await readFile(indexPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    existing = createIndexFile(input);
  }

  const lines = existing.split(/\r?\n/);
  const filtered = lines.filter(
    (line) => !line.includes(`](${input.exported.filename})`),
  );
  const insertionIndex = filtered.findIndex((line) => line.trim() === "");

  if (insertionIndex === -1) {
    filtered.push("", entry);
  } else {
    filtered.splice(insertionIndex, 0, entry);
  }

  await writeFile(indexPath, `${filtered.join("\n").trimEnd()}\n`, "utf8");
}

function createIndexFile(input: {
  document: ExportDocument;
  exportedAt: Date;
  knowledgeVersion: string;
}) {
  const lastVerified = toIsoDate(input.exportedAt);
  const frontmatter = stringifyFrontmatter({
    type: "aircraft_index",
    review_status: "approved",
    title: "AV-OKF Knowledge Index",
    description: "Index of exported AV-OKF knowledge topics.",
    aircraft_family: input.document.aircraftFamily || "Unknown",
    knowledge_version: input.knowledgeVersion,
    last_verified: lastVerified,
  });

  return `---\n${frontmatter}---\n\n# AV-OKF Knowledge Index\n\n`;
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

function stringifyFrontmatter(fields: Record<string, string | number[]>) {
  return Object.entries(fields)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((item) => `  - ${item}`).join("\n")}\n`;
      }

      return `${key}: ${quoteYamlString(String(value))}\n`;
    })
    .join("");
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
  const topicIdFragment = topic.id.slice(0, TOPIC_ID_FRAGMENT_LENGTH);

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
