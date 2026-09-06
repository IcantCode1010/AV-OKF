import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  deriveOkfTrustTier,
  getFrontmatterSources,
  getFrontmatterStringArray,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";
import { normalizeProjectEfbAtaChapter } from "./project-efb-article-classification.ts";

export type EfbReleaseConfig = {
  schemaVersion: "1.0";
  mode?: "poc" | "production";
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
  applicability: { aircraftFamilyIds: string[]; aircraftTypeIds: string[] };
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
    schemaVersion: "2.0" | "2.1";
    nativeArtifacts?: string[];
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

export type EfbReleaseSourceEntry = {
  markdown: string;
  relativePath: string;
};

export const EFB_POC_AUTHORITY_LABEL =
  "Unreviewed prototype knowledge — not approved instructions";

const ENTRY_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export async function exportEfbRelease(input: {
  config: EfbReleaseConfig;
  knowledgeRoot?: string;
  outputRoot: string;
  sourceEntries?: EfbReleaseSourceEntry[];
  supportingAssets?: Array<{ nativePath: string; sourcePath: string; entryId: string; title: string;
    mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" }>;
  signer?: (payload: string) => Promise<{
    algorithm: "ed25519";
    keyId: string;
    value: string;
  }>;
  validateStagedPackage?: (manifestPath: string) => Promise<void>;
}): Promise<EfbReleaseResult> {
  validateConfig(input.config);
  const mode = input.config.mode ?? "production";
  const packageVersionId = `${input.config.packageId}@${input.config.version}`;
  const releaseDirectory = mode === "poc"
    ? path.join(input.outputRoot, packageVersionId)
    : path.join(input.outputRoot, input.config.packageId, input.config.version);
  if (await exists(releaseDirectory)) {
    throw new Error(`efb_release_version_already_exists:${packageVersionId}`);
  }
  const sourceEntries = input.sourceEntries ?? (
    input.knowledgeRoot ? await loadMarkdownEntries(input.knowledgeRoot) : []
  );
  const prepared: PreparedEntry[] = [];
  const nativeEntries: Array<{ id: string; path: string; markdown: string }> = [];

  for (const sourceEntry of sourceEntries) {
    const relative = normalizeSourceRelativePath(sourceEntry.relativePath);
    if (mode === "poc" && isInfrastructureFile(relative)) continue;
    const parsed = parseOkfMarkdown(sourceEntry.markdown);
    if (mode === "production" && parsed.frontmatter.efb_inclusion_status === undefined) continue;
    prepared.push(prepareEntry({
      config: input.config,
      mode,
      packageVersionId,
      parsed,
      relative,
    }));
    nativeEntries.push({ id: prepared.at(-1)!.entry.id, path: relative, markdown: sourceEntry.markdown });
  }

  if (prepared.length === 0) {
    throw new Error("efb_release_requires_included_entries");
  }

  prepared.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  assertUnique(prepared.map((item) => item.entry.id), "efb_entry_id_duplicate");
  const entryIds = new Set(prepared.map((item) => item.entry.id));
  for (const item of prepared) {
    for (const relatedId of item.entry.relatedEntryIds) {
      if (!entryIds.has(relatedId) && !(mode === "production" && /^okf:\/\/[a-z0-9][a-z0-9.-]*@[a-zA-Z0-9][a-zA-Z0-9.+-]*\/[^\\?#]+(?:#[^\s]+)?$/.test(relatedId))) {
        throw new Error(`efb_related_entry_missing:${item.entry.id}:${relatedId}`);
      }
    }
  }

  const artifacts = new Map<string, string | Uint8Array>();
  for (const item of prepared) {
    artifacts.set(item.entry.contentArtifactPath, item.content);
    artifacts.set(item.entry.agentArtifactPath, item.agent);
  }
  artifacts.set("retrieval.jsonl", buildKeywordIndex(prepared));
  assertPreparedArtifactParity(prepared, artifacts.get("retrieval.jsonl") as string);

  if (mode === "production") {
    const assets = input.supportingAssets ?? [];
    assertUnique(assets.map(asset => asset.nativePath), "efb_asset_path_duplicate");
    for (const asset of assets) {
      const assetPath = normalizeSourceRelativePath(asset.nativePath);
      if (!entryIds.has(asset.entryId)) throw new Error(`efb_asset_owner_missing:${asset.entryId}`);
      const bytes = await readFile(asset.sourcePath);
      if (!bytes.length || bytes.length > 3000000) throw new Error(`efb_asset_size_limit:${assetPath}`);
      artifacts.set(`native/assets/${assetPath}`, bytes);
    }
    for (const native of nativeEntries) artifacts.set(`native/tree/${native.path}`, native.markdown);
    artifacts.set("native/catalog.json", stableJson({
      schemaVersion: "1.0", formatVersion: "0.2", packageVersionId,
      packageId: input.config.packageId, version: input.config.version,
      license: input.config.license, sourceCommit: input.config.sourceCommit,
      curator: input.config.curator, validatedAt: input.config.validatedAt,
      entries: prepared.map(({ entry }) => ({ ...entry,
        nativePath: nativeEntries.find((native) => native.id === entry.id)!.path })),
      assets: assets.map(({ sourcePath, ...asset }) => {
        void sourcePath;
        return asset;
      }),
    }));
  }

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
    schemaVersion: mode === "production" ? "2.1" : "2.0",
    ...(mode === "production" ? { nativeArtifacts: [...artifacts.keys()].filter((artifactPath) => artifactPath.startsWith("native/")).sort() } : {}),
    id: packageVersionId,
    packageId: input.config.packageId,
    version: input.config.version,
    format: { name: "open-knowledge-format", version: "0.2" },
    license: input.config.license,
    provenance: {
      source: mode === "poc"
        ? input.config.source
        : `${input.config.source}@${input.config.sourceCommit}`,
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
    if (input.validateStagedPackage) {
      await input.validateStagedPackage(path.join(stagingDirectory, "manifest.json"));
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
  mode: "poc" | "production";
  packageVersionId: string;
  parsed: ReturnType<typeof parseOkfMarkdown>;
  relative: string;
}): PreparedEntry {
  const { frontmatter, body } = input.parsed;
  if (frontmatter.status !== "stable") {
    throw new Error(`efb_entry_must_be_stable:${input.relative}`);
  }
  if (input.mode === "production" && deriveOkfTrustTier(frontmatter) !== "human_reviewed") {
    throw new Error(`efb_entry_requires_human_review:${input.relative}`);
  }
  if (
    input.mode === "production" &&
    frontmatter.efb_inclusion_status !== "approved-for-inclusion"
  ) {
    throw new Error(`efb_inclusion_status_invalid:${input.relative}`);
  }

  const id = requiredScalar(frontmatter, "efb_entry_id", input.relative);
  if (!ENTRY_ID_PATTERN.test(id)) throw new Error(`efb_entry_id_invalid:${id}`);
  const title = requiredScalar(frontmatter, "title", input.relative);
  const summary = requiredScalar(frontmatter, "description", input.relative);
  const authorityLabel = input.mode === "poc"
    ? EFB_POC_AUTHORITY_LABEL
    : requiredScalar(frontmatter, "efb_authority_label", input.relative);
  const sourceClassification = input.mode === "production"
    ? requiredScalar(frontmatter, "efb_source_classification", input.relative) as EfbSourceClassification
    : "training-reference";
  if (input.mode === "production") {
    requiredScalar(frontmatter, "efb_content_purpose", input.relative);
    if (!["controlled-document", "open-reference", "training-reference"].includes(sourceClassification)) {
      throw new Error(`efb_source_classification_invalid:${id}`);
    }
    const license = requiredScalar(frontmatter, "efb_license_identifier", input.relative);
    if (license !== input.config.license.identifier) {
      throw new Error(`efb_entry_license_mismatch:${id}`);
    }
    requiredScalar(frontmatter, "efb_license_reviewed_by", input.relative);
    requiredIsoDate(frontmatter, "efb_license_reviewed_at", input.relative);
  }
  const audiences = requiredStringArrayWithFallback(
    frontmatter,
    input.mode === "poc" ? ["intended_audiences", "efb_audiences"] : ["efb_audiences"],
    input.relative,
  );
  if (audiences.some((audience) => audience !== "pilot" && audience !== "maintenance")) {
    throw new Error(`efb_audience_invalid:${id}`);
  }
  const aircraftTypeIds = optionalStringArrayWithFallback(
    frontmatter,
    input.mode === "poc" ? ["aircraft_type_ids", "efb_aircraft_type_ids"] : ["efb_aircraft_type_ids"],
  );
  const aircraftFamilyIds = optionalStringArrayWithFallback(
    frontmatter,
    input.mode === "poc" ? ["aircraft_family_ids", "efb_aircraft_family_ids"] : ["efb_aircraft_family_ids"],
  );
  if (aircraftFamilyIds.length === 0 && aircraftTypeIds.length === 0) {
    throw new Error(`efb_applicability_required:${id}`);
  }
  const placementSpecs = input.mode === "poc"
    ? buildPocPlacementSpecs(frontmatter)
    : requiredStringArray(frontmatter, "efb_placements", input.relative);
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
  const displayBody = input.mode === "poc"
    ? buildPocDisplayBody(title, body)
    : `${body.trimEnd()}\n`;
  validateContentQuality({
    aircraftTypeIds,
    authorityLabel,
    body: displayBody,
    frontmatter,
    id,
    mode: input.mode,
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
    applicability: { aircraftFamilyIds, aircraftTypeIds },
    authorityLabel,
    inclusionStatus: "approved-for-inclusion",
  };
  const placements = placementSpecs.map((spec) => parsePlacement(spec, id));
  assertUnique(placements.map((placement) => placement.id), "efb_placement_id_duplicate");
  const content = displayBody;
  const agent = stableJson({
    schemaVersion: "1.0",
    entryId: id,
    packageVersionId: input.packageVersionId,
    title,
    summary,
    body: body.trim(),
    tags,
    audiences,
    applicability: { aircraftFamilyIds, aircraftTypeIds },
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
  if (kind === "ata" && normalizeProjectEfbAtaChapter(targetId) !== targetId) {
    throw new Error(`efb_ata_target_invalid:${entryId}:${targetId}`);
  }
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
    aircraftFamilyIds: entry.applicability.aircraftFamilyIds,
    aircraftTypeIds: entry.applicability.aircraftTypeIds,
    placements: placements.map(({ kind, targetId }) => ({ kind, targetId })),
    authorityLabel: entry.authorityLabel,
    searchableText: normalizeSearchText([entry.title, entry.summary, ...entry.tags, body].join(" ")),
  })).join("\n") + "\n";
}

function assertPreparedArtifactParity(prepared: PreparedEntry[], retrievalJsonl: string): void {
  const retrievalById = new Map(retrievalJsonl.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    return [record.entryId, record] as const;
  }));
  for (const item of prepared) {
    const agent = JSON.parse(item.agent) as Record<string, unknown>;
    const retrieval = retrievalById.get(item.entry.id);
    if (!retrieval) throw new Error(`efb_artifact_parity_missing_retrieval:${item.entry.id}`);
    const expectedApplicability = item.entry.applicability;
    const expectedPlacements = item.placements.map(({ kind, targetId }) => ({ kind, targetId }));
    const checks = [
      ["agent_audiences", agent.audiences, item.entry.audiences],
      ["agent_applicability", agent.applicability, expectedApplicability],
      ["agent_placements", agent.placements, expectedPlacements],
      ["retrieval_audiences", retrieval.audiences, item.entry.audiences],
      ["retrieval_aircraft_families", retrieval.aircraftFamilyIds, expectedApplicability.aircraftFamilyIds],
      ["retrieval_aircraft_types", retrieval.aircraftTypeIds, expectedApplicability.aircraftTypeIds],
      ["retrieval_placements", retrieval.placements, expectedPlacements],
    ] as const;
    for (const [field, actual, expected] of checks) {
      if (stableJsonValue(actual) !== stableJsonValue(expected)) {
        throw new Error(`efb_artifact_parity_mismatch:${item.entry.id}:${field}`);
      }
    }
  }
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

async function loadMarkdownEntries(root: string): Promise<EfbReleaseSourceEntry[]> {
  const files = await listMarkdownFiles(root);
  return Promise.all(files.map(async (sourceFile) => ({
    markdown: await readFile(sourceFile, "utf8"),
    relativePath: toPosix(path.relative(root, sourceFile)),
  })));
}

function normalizeSourceRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    !value.trim() ||
    path.isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`efb_source_path_unsafe:${value}`);
  }
  return normalized;
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

function requiredStringArrayWithFallback(
  frontmatter: Record<string, unknown>,
  keys: string[],
  source: string,
): string[] {
  for (const key of keys) {
    const values = getFrontmatterStringArray(frontmatter, key)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.length > 0) return unique(values);
  }
  throw new Error(`efb_metadata_required:${keys[0]}:${source}`);
}

function optionalStringArrayWithFallback(
  frontmatter: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const values = getFrontmatterStringArray(frontmatter, key)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.length > 0) return unique(values);
  }
  return [];
}

function buildPocPlacementSpecs(
  frontmatter: Record<string, unknown>,
): string[] {
  const explicit = getFrontmatterStringArray(frontmatter, "efb_placements");
  if (explicit.length > 0) return explicit;
  const ata = normalizeProjectEfbAtaChapter(frontmatter.ata);
  if (!ata) return [];
  const page = Array.isArray(frontmatter.source_pages)
    ? frontmatter.source_pages.find((value) => Number.isInteger(value) && Number(value) > 0)
    : null;
  const order = typeof page === "number" ? page * 10 : 10;
  const tags = getFrontmatterStringArray(frontmatter, "tags").map((value) => value.toLowerCase());
  const manualType = typeof frontmatter.manual_type === "string"
    ? frontmatter.manual_type.toLowerCase()
    : "";
  return [
    `ata:${ata}:${order}`,
    ...(
      tags.some((tag) => tag.includes("qrh")) || manualType.includes("quick reference")
        ? [`qrh:${ata}:${order}`]
        : []
    ),
  ];
}

function buildPocDisplayBody(title: string, body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  const withHeading = /^#\s+\S/m.test(normalized)
    ? normalized
    : `# ${title}\n\n${normalized}`;
  return `${withHeading}\n\n> ${EFB_POC_AUTHORITY_LABEL}.\n`;
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
  mode: "poc" | "production";
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
  const ata = normalizeProjectEfbAtaChapter(input.frontmatter.ata);
  const ataPlacements = input.placementSpecs
    .filter((placement) => placement.startsWith("ata:"))
    .map((placement) => placement.split(":")[1]!.padStart(2, "0"));
  if (input.frontmatter.ata !== undefined && !ata) {
    throw new Error(`efb_entry_ata_invalid:${input.id}`);
  }
  if (ata && (ataPlacements.length === 0 || ataPlacements.some((target) => target !== ata))) {
    throw new Error(`efb_entry_ata_contradiction:${input.id}`);
  }
  if (input.mode === "production" && !ata) throw new Error(`efb_metadata_required:ata:${input.id}`);

  const aircraftFamily = input.mode === "production"
    ? requiredScalar(input.frontmatter, "aircraft_family", input.id)
    : "";
  const effectivity = input.mode === "production"
    ? requiredScalar(input.frontmatter, "effectivity", input.id)
    : "";
  for (const aircraftTypeId of input.aircraftTypeIds) {
    if (input.mode === "poc") {
      if (!/^[a-z0-9][a-z0-9-]{1,11}$/.test(aircraftTypeId)) {
        throw new Error(`efb_aircraft_type_invalid:${input.id}:${aircraftTypeId}`);
      }
    } else {
      validateAircraftApplicability({
        aircraftFamily,
        aircraftTypeId,
        effectivity,
        entryId: input.id,
      });
    }
  }
  if (input.mode === "poc") return;
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
