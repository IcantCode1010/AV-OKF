import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  deriveOkfTrustTier,
  getFrontmatterSources,
  getFrontmatterStringArray,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";

export type EfbReleaseConfig = {
  schemaVersion: "1.0";
  packageId: string;
  version: string;
  source: string;
  sourceCommit: string;
  curator: string;
  curatedAt: string;
  validatedAt: string;
  validator: string;
  validationProfile: string;
  license: {
    identifier: string;
    attribution?: string;
  };
};

type EfbAudience = "pilot" | "maintenance";
type EfbPlacementKind = "ata" | "qrh" | "quick-access";
type EfbSourceClassification =
  | "controlled-document"
  | "open-reference"
  | "training-reference";

type EfbEntry = {
  id: string;
  packageVersionId: string;
  title: string;
  summary: string;
  tags: string[];
  audiences: EfbAudience[];
  contentArtifactPath: string;
  agentArtifactPath: string;
  sourceReferences: Array<{ id: string; label: string; locator?: string }>;
  relatedEntryIds: string[];
  applicability: { aircraftTypeIds: string[] };
  authorityLabel: string;
  inclusionStatus: "approved-for-inclusion";
};

type EfbPlacement = {
  id: string;
  entryId: string;
  kind: EfbPlacementKind;
  targetId: string;
  displayOrder: number;
};

export type EfbReleaseResult = {
  releaseDirectory: string;
  manifestPath: string;
  manifest: {
    schemaVersion: "2.0";
    id: string;
    packageId: string;
    version: string;
    format: { name: "open-knowledge-format"; version: "0.2" };
    license: EfbReleaseConfig["license"];
    provenance: { source: string; curator: string; curatedAt: string };
    trust: { validationProfile: string; validatedAt: string; validator: string };
    checksum: { algorithm: "sha256"; value: string };
    signature?: { algorithm: "ed25519"; keyId: string; value: string };
    entries: EfbEntry[];
    placements: EfbPlacement[];
    createdAt: string;
  };
};

type PreparedEntry = {
  entry: EfbEntry;
  placements: EfbPlacement[];
  body: string;
  content: string;
  agent: string;
};

const ENTRY_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export async function exportEfbRelease(input: {
  config: EfbReleaseConfig;
  knowledgeRoot: string;
  outputRoot: string;
  signer?: (payload: string) => Promise<{
    algorithm: "ed25519";
    keyId: string;
    value: string;
  }>;
}): Promise<EfbReleaseResult> {
  validateConfig(input.config);
  const packageVersionId = `${input.config.packageId}@${input.config.version}`;
  const releaseDirectory = path.join(
    input.outputRoot,
    input.config.packageId,
    input.config.version,
  );
  if (await exists(releaseDirectory)) {
    throw new Error(`efb_release_version_already_exists:${packageVersionId}`);
  }
  const markdownFiles = await listMarkdownFiles(input.knowledgeRoot);
  const prepared: PreparedEntry[] = [];

  for (const sourceFile of markdownFiles) {
    const relative = toPosix(path.relative(input.knowledgeRoot, sourceFile));
    if (isInfrastructureFile(relative)) continue;
    const markdown = await readFile(sourceFile, "utf8");
    const parsed = parseOkfMarkdown(markdown);
    if (parsed.frontmatter.efb_inclusion_status === undefined) continue;
    prepared.push(prepareEntry({
      config: input.config,
      packageVersionId,
      parsed,
      relative,
    }));
  }

  if (prepared.length === 0) {
    throw new Error("efb_release_requires_included_entries");
  }

  prepared.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  assertUnique(prepared.map((item) => item.entry.id), "efb_entry_id_duplicate");
  const entryIds = new Set(prepared.map((item) => item.entry.id));
  for (const item of prepared) {
    for (const relatedId of item.entry.relatedEntryIds) {
      if (!entryIds.has(relatedId)) {
        throw new Error(`efb_related_entry_missing:${item.entry.id}:${relatedId}`);
      }
    }
  }

  const artifacts = new Map<string, string>();
  for (const item of prepared) {
    artifacts.set(item.entry.contentArtifactPath, item.content);
    artifacts.set(item.entry.agentArtifactPath, item.agent);
  }
  artifacts.set("retrieval.jsonl", buildKeywordIndex(prepared));

  const artifactChecksums = [...artifacts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactPath, content]) => ({
      path: artifactPath,
      sha256: sha256(content),
    }));
  const packageChecksum = sha256(stableJson(artifactChecksums));
  const signaturePayload = buildPackageSignaturePayload({
    packageVersionId,
    checksum: packageChecksum,
  });
  const signature = input.signer ? await input.signer(signaturePayload) : undefined;
  if (signature && (!signature.keyId.trim() || !signature.value.trim())) {
    throw new Error("efb_release_signature_invalid");
  }
  const manifest: EfbReleaseResult["manifest"] = {
    schemaVersion: "2.0",
    id: packageVersionId,
    packageId: input.config.packageId,
    version: input.config.version,
    format: { name: "open-knowledge-format", version: "0.2" },
    license: input.config.license,
    provenance: {
      source: `${input.config.source}@${input.config.sourceCommit}`,
      curator: input.config.curator,
      curatedAt: input.config.curatedAt,
    },
    trust: {
      validationProfile: input.config.validationProfile,
      validatedAt: input.config.validatedAt,
      validator: input.config.validator,
    },
    checksum: { algorithm: "sha256", value: packageChecksum },
    ...(signature ? { signature } : {}),
    entries: prepared.map((item) => item.entry),
    placements: prepared.flatMap((item) => item.placements)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)),
    createdAt: input.config.validatedAt,
  };
  const manifestContent = stableJson(manifest);
  artifacts.set("manifest.json", manifestContent);
  artifacts.set("release.json", stableJson({
    schemaVersion: "1.0",
    packageVersionId,
    sourceCommit: input.config.sourceCommit,
    retrieval: {
      strategy: "structured-keyword",
      artifactPath: "retrieval.jsonl",
      recordCount: prepared.length,
    },
    packageChecksum: manifest.checksum,
    signature: signature
      ? { algorithm: signature.algorithm, keyId: signature.keyId, payload: signaturePayload }
      : null,
  }));
  artifacts.set("checksums.sha256", [
    ...artifactChecksums,
    { path: "manifest.json", sha256: sha256(manifestContent) },
  ].sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => `${item.sha256}  ${item.path}`)
    .join("\n") + "\n");

  const packageDirectory = path.dirname(releaseDirectory);
  await mkdir(packageDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(path.join(packageDirectory, ".efb-release-staging-"));
  try {
    for (const [artifactPath, content] of artifacts) {
      const destination = path.join(stagingDirectory, ...artifactPath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    await rename(stagingDirectory, releaseDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    releaseDirectory,
    manifestPath: path.join(releaseDirectory, "manifest.json"),
    manifest,
  };
}

export function buildPackageSignaturePayload(input: {
  packageVersionId: string;
  checksum: string;
}): string {
  return [
    "project-efb-knowledge-package-v2",
    input.packageVersionId,
    `sha256:${input.checksum}`,
    "",
  ].join("\n");
}

function prepareEntry(input: {
  config: EfbReleaseConfig;
  packageVersionId: string;
  parsed: ReturnType<typeof parseOkfMarkdown>;
  relative: string;
}): PreparedEntry {
  const { frontmatter, body } = input.parsed;
  if (frontmatter.status !== "stable") {
    throw new Error(`efb_entry_must_be_stable:${input.relative}`);
  }
  if (deriveOkfTrustTier(frontmatter) !== "human_reviewed") {
    throw new Error(`efb_entry_requires_human_review:${input.relative}`);
  }
  if (frontmatter.efb_inclusion_status !== "approved-for-inclusion") {
    throw new Error(`efb_inclusion_status_invalid:${input.relative}`);
  }

  const id = requiredScalar(frontmatter, "efb_entry_id", input.relative);
  if (!ENTRY_ID_PATTERN.test(id)) throw new Error(`efb_entry_id_invalid:${id}`);
  const title = requiredScalar(frontmatter, "title", input.relative);
  const summary = requiredScalar(frontmatter, "description", input.relative);
  const authorityLabel = requiredScalar(frontmatter, "efb_authority_label", input.relative);
  requiredScalar(frontmatter, "efb_content_purpose", input.relative);
  const sourceClassification = requiredScalar(
    frontmatter,
    "efb_source_classification",
    input.relative,
  ) as EfbSourceClassification;
  if (![
    "controlled-document",
    "open-reference",
    "training-reference",
  ].includes(sourceClassification)) {
    throw new Error(`efb_source_classification_invalid:${id}`);
  }
  const license = requiredScalar(frontmatter, "efb_license_identifier", input.relative);
  if (license !== input.config.license.identifier) {
    throw new Error(`efb_entry_license_mismatch:${id}`);
  }
  requiredScalar(frontmatter, "efb_license_reviewed_by", input.relative);
  requiredIsoDate(frontmatter, "efb_license_reviewed_at", input.relative);
  const audiences = requiredStringArray(frontmatter, "efb_audiences", input.relative);
  if (audiences.some((audience) => audience !== "pilot" && audience !== "maintenance")) {
    throw new Error(`efb_audience_invalid:${id}`);
  }
  const aircraftTypeIds = requiredStringArray(
    frontmatter,
    "efb_aircraft_type_ids",
    input.relative,
  );
  const placementSpecs = requiredStringArray(frontmatter, "efb_placements", input.relative);
  const tags = unique(getFrontmatterStringArray(frontmatter, "tags"));
  const relatedEntryIds = unique(
    getFrontmatterStringArray(frontmatter, "efb_related_entry_ids"),
  );
  const sourceReferences = getFrontmatterSources(frontmatter).map((source, index) => ({
    id: source.id ?? `${id}-source-${index + 1}`,
    label: source.title ?? source.resource,
    locator: buildSourceLocator(frontmatter),
  }));
  if (sourceReferences.length === 0) {
    throw new Error(`efb_entry_requires_source_reference:${id}`);
  }
  validateContentQuality({
    aircraftTypeIds,
    authorityLabel,
    body,
    frontmatter,
    id,
    placementSpecs,
    sourceClassification,
    summary,
    title,
  });

  const contentArtifactPath = `display/${id}.md`;
  const agentArtifactPath = `agent/${id}.json`;
  const entry: EfbEntry = {
    id,
    packageVersionId: input.packageVersionId,
    title,
    summary,
    tags,
    audiences: audiences as EfbAudience[],
    contentArtifactPath,
    agentArtifactPath,
    sourceReferences,
    relatedEntryIds,
    applicability: { aircraftTypeIds },
    authorityLabel,
    inclusionStatus: "approved-for-inclusion",
  };
  const placements = placementSpecs.map((spec) => parsePlacement(spec, id));
  assertUnique(placements.map((placement) => placement.id), "efb_placement_id_duplicate");
  const content = `${body.trimEnd()}\n`;
  const agent = stableJson({
    schemaVersion: "1.0",
    entryId: id,
    packageVersionId: input.packageVersionId,
    title,
    summary,
    body: body.trim(),
    tags,
    audiences,
    applicability: { aircraftTypeIds },
    placements: placements.map(({ kind, targetId }) => ({ kind, targetId })),
    authorityLabel,
    sourceReferences,
    relatedEntryIds,
  });
  return { entry, placements, body, content, agent };
}

function parsePlacement(spec: string, entryId: string): EfbPlacement {
  const match = /^(ata|qrh|quick-access):([^:]+):(\d+)$/.exec(spec);
  if (!match) throw new Error(`efb_placement_invalid:${entryId}:${spec}`);
  const [, kind, targetId, order] = match;
  const displayOrder = Number(order);
  return {
    id: `${entryId}-${kind}-${slug(targetId!)}`,
    entryId,
    kind: kind as EfbPlacementKind,
    targetId: targetId!,
    displayOrder,
  };
}

function buildKeywordIndex(prepared: PreparedEntry[]): string {
  return prepared.map(({ entry, body, placements }) => stableJsonValue({
    schemaVersion: "1.0",
    entryId: entry.id,
    packageVersionId: entry.packageVersionId,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    audiences: entry.audiences,
    aircraftTypeIds: entry.applicability.aircraftTypeIds,
    placements: placements.map(({ kind, targetId }) => ({ kind, targetId })),
    authorityLabel: entry.authorityLabel,
    searchableText: normalizeSearchText([entry.title, entry.summary, ...entry.tags, body].join(" ")),
  })).join("\n") + "\n";
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const location = path.join(root, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(location);
    return entry.isFile() && entry.name.endsWith(".md") ? [location] : [];
  }));
  return files.flat().sort();
}

function isInfrastructureFile(relative: string): boolean {
  const name = path.posix.basename(relative);
  return name === "index.md" || name === "log.md" || relative.startsWith("references/");
}

function requiredScalar(
  frontmatter: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = frontmatter[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`efb_metadata_required:${key}:${source}`);
  }
  return value.trim();
}

function requiredStringArray(
  frontmatter: Record<string, unknown>,
  key: string,
  source: string,
): string[] {
  const values = getFrontmatterStringArray(frontmatter, key)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`efb_metadata_required:${key}:${source}`);
  return unique(values);
}

function requiredIsoDate(
  frontmatter: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = requiredScalar(frontmatter, key, source);
  if (Number.isNaN(Date.parse(value)) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    throw new Error(`efb_metadata_date_invalid:${key}:${source}`);
  }
  return value;
}

function validateContentQuality(input: {
  aircraftTypeIds: string[];
  authorityLabel: string;
  body: string;
  frontmatter: Record<string, unknown>;
  id: string;
  placementSpecs: string[];
  sourceClassification: EfbSourceClassification;
  summary: string;
  title: string;
}): void {
  const normalizedBody = input.body.trim();
  if (!normalizedBody) throw new Error(`efb_entry_body_required:${input.id}`);
  if (normalizedBody.length < 80) throw new Error(`efb_entry_body_too_short:${input.id}`);
  if (!/^#\s+\S/m.test(normalizedBody)) {
    throw new Error(`efb_entry_display_heading_required:${input.id}`);
  }
  for (const [field, value] of [["title", input.title], ["summary", input.summary], ["body", normalizedBody]]) {
    if (/(?:\.\.\.|…|\bfor tra)\s*$/i.test(value)) {
      throw new Error(`efb_entry_truncated:${input.id}:${field}`);
    }
  }

  const sourcePages = input.frontmatter.source_pages;
  if (!Array.isArray(sourcePages) || sourcePages.length === 0 || sourcePages.some((page) => !Number.isInteger(page) || Number(page) < 1)) {
    throw new Error(`efb_entry_source_pages_invalid:${input.id}`);
  }
  const ata = requiredScalar(input.frontmatter, "ata", input.id)
    .replace(/^ATA[\s-]*/i, "")
    .padStart(2, "0");
  const ataPlacements = input.placementSpecs
    .filter((placement) => placement.startsWith("ata:"))
    .map((placement) => placement.split(":")[1]!.padStart(2, "0"));
  if (ataPlacements.length === 0 || ataPlacements.some((target) => target !== ata)) {
    throw new Error(`efb_entry_ata_contradiction:${input.id}`);
  }

  const aircraftFamily = requiredScalar(input.frontmatter, "aircraft_family", input.id);
  const effectivity = requiredScalar(input.frontmatter, "effectivity", input.id);
  for (const aircraftTypeId of input.aircraftTypeIds) {
    validateAircraftApplicability({
      aircraftFamily,
      aircraftTypeId,
      effectivity,
      entryId: input.id,
    });
  }
  const sourceAuthority = requiredScalar(input.frontmatter, "source_authority", input.id);
  if (
    input.sourceClassification === "training-reference" &&
    /maintenance\s+manual|flight\s+manual|approved\s+data/i.test(sourceAuthority)
  ) {
    throw new Error(`efb_entry_source_authority_contradiction:${input.id}`);
  }
  if (
    input.sourceClassification !== "controlled-document" &&
    !/not\s+approved|not\s+controlled|training|open\s+reference/i.test(input.authorityLabel)
  ) {
    throw new Error(`efb_entry_authority_warning_required:${input.id}`);
  }
}

function validateAircraftApplicability(input: {
  aircraftFamily: string;
  aircraftTypeId: string;
  effectivity: string;
  entryId: string;
}): void {
  const evidence = `${input.aircraftFamily} ${input.effectivity}`;
  if (input.aircraftTypeId === "b738") {
    if (!/(?:\bb738\b|\b737(?:-?800|\s*ng)?\b)/i.test(evidence) || /\b737\s*max\b|\ba3(?:18|19|20|21)\b/i.test(evidence)) {
      throw new Error(`efb_entry_aircraft_contradiction:${input.entryId}:b738`);
    }
    return;
  }
  if (input.aircraftTypeId === "a320-251n") {
    if (!/\b(?:a320|a20n)\b/i.test(evidence) || /\b737\b/i.test(evidence)) {
      throw new Error(`efb_entry_aircraft_contradiction:${input.entryId}:a320-251n`);
    }
    return;
  }
  throw new Error(`efb_aircraft_type_unsupported:${input.entryId}:${input.aircraftTypeId}`);
}

function buildSourceLocator(frontmatter: Record<string, unknown>): string | undefined {
  const pages = Array.isArray(frontmatter.source_pages)
    ? frontmatter.source_pages.filter((page) => Number.isInteger(page))
    : [];
  if (pages.length === 0) return undefined;
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
}

function validateConfig(config: EfbReleaseConfig): void {
  for (const [key, value] of Object.entries({
    packageId: config.packageId,
    version: config.version,
    source: config.source,
    sourceCommit: config.sourceCommit,
    curator: config.curator,
    curatedAt: config.curatedAt,
    validatedAt: config.validatedAt,
    validator: config.validator,
    validationProfile: config.validationProfile,
    licenseIdentifier: config.license.identifier,
  })) {
    if (!value?.trim()) throw new Error(`efb_release_config_required:${key}`);
  }
  if (config.schemaVersion !== "1.0") throw new Error("efb_release_config_version_invalid");
  if (!GIT_COMMIT_PATTERN.test(config.sourceCommit)) throw new Error("efb_source_commit_invalid");
  for (const [key, value] of [["curatedAt", config.curatedAt], ["validatedAt", config.validatedAt]]) {
    if (Number.isNaN(Date.parse(value))) throw new Error(`efb_release_config_date_invalid:${key}`);
  }
}

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function stableJsonValue(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function exists(location: string): Promise<boolean> {
  try {
    await stat(location);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
