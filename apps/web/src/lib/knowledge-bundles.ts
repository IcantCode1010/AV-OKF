import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import {
  BASE_FIELDS,
  getTypeDirectory,
  getKnowledgeProfileTemplate,
  normalizeKnowledgeProfile,
  type KnowledgeProfileSchema,
  validateKnowledgeProfile,
} from "./knowledge-profile.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";
import { getPrisma } from "./prisma.ts";

export type KnowledgeBundleRecord = {
  activeProfileVersion: number;
  createdAt: string;
  description: string;
  id: string;
  name: string;
  profile: KnowledgeProfileSchema;
  slug: string;
  status: string;
  updatedAt: string;
  workspaceId: string;
};

export const LOCAL_GENERAL_BUNDLE_ID = "kb_general_local";

export async function listKnowledgeBundles(
  context: AuthWorkspaceContext,
): Promise<KnowledgeBundleRecord[]> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    return [localGeneralBundle(context.workspaceId)];
  }

  const records = await getPrisma().knowledgeBundle.findMany({
    include: { activeProfileVersion: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: { status: "active", workspaceId: context.workspaceId },
  });

  return records.map(mapBundleRecord);
}

export async function getKnowledgeBundle(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
}): Promise<KnowledgeBundleRecord | null> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    return input.bundleId === LOCAL_GENERAL_BUNDLE_ID
      ? localGeneralBundle(input.context.workspaceId)
      : null;
  }

  const record = await getPrisma().knowledgeBundle.findFirst({
    include: { activeProfileVersion: true },
    where: {
      id: input.bundleId,
      status: "active",
      workspaceId: input.context.workspaceId,
    },
  });

  return record ? mapBundleRecord(record) : null;
}

export async function getKnowledgeBundleByIdentity(input: {
  bundleId: string;
  workspaceId: string;
}): Promise<KnowledgeBundleRecord | null> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    return input.bundleId === LOCAL_GENERAL_BUNDLE_ID
      ? localGeneralBundle(input.workspaceId)
      : null;
  }

  const record = await getPrisma().knowledgeBundle.findFirst({
    include: { activeProfileVersion: true },
    where: {
      id: input.bundleId,
      status: "active",
      workspaceId: input.workspaceId,
    },
  });
  return record ? mapBundleRecord(record) : null;
}

export async function getDefaultKnowledgeBundle(
  context: AuthWorkspaceContext,
): Promise<KnowledgeBundleRecord> {
  const bundles = await listKnowledgeBundles(context);
  const general = bundles.find((bundle) => bundle.slug === "general");
  if (general) return general;
  if (bundles[0]) return bundles[0];
  return createKnowledgeBundle({
    context,
    description: "General-purpose reviewed knowledge.",
    name: "General Knowledge",
    templateId: "generic",
  });
}

export async function createKnowledgeBundle(input: {
  context: AuthWorkspaceContext;
  description?: string;
  name: string;
  templateId: "aviation" | "generic";
}): Promise<KnowledgeBundleRecord> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    throw new Error("knowledge_bundle_creation_requires_production_backend");
  }

  const name = input.name.trim();
  if (!name) throw new Error("knowledge_bundle_name_required");
  const slug = slugifyBundleName(name);
  if (!slug) throw new Error("knowledge_bundle_name_invalid");
  const profile = getKnowledgeProfileTemplate(input.templateId);
  const profileErrors = validateKnowledgeProfile(profile);
  if (profileErrors.length > 0) throw new Error(profileErrors[0]);

  const bundle = await getPrisma().$transaction(async (tx) => {
    const created = await tx.knowledgeBundle.create({
      data: {
        createdBy: input.context.userId,
        description: input.description?.trim() ?? "",
        name,
        slug,
        workspaceId: input.context.workspaceId,
      },
    });
    const version = await tx.knowledgeBundleProfileVersion.create({
      data: {
        activatedAt: new Date(),
        bundleId: created.id,
        createdBy: input.context.userId,
        schema: profile,
        status: "active",
        templateId: input.templateId,
        version: 1,
      },
    });
    return tx.knowledgeBundle.update({
      data: { activeProfileVersionId: version.id },
      include: { activeProfileVersion: true },
      where: { id: created.id },
    });
  });

  try {
    await scaffoldKnowledgeBundle({
      bundleId: bundle.id,
      profile,
      workspaceId: input.context.workspaceId,
    });
    await writeWorkspaceVault(input.context.workspaceId);
  } catch (error) {
    await getPrisma().knowledgeBundle.delete({ where: { id: bundle.id } });
    throw error;
  }

  return mapBundleRecord(bundle);
}

export function resolveKnowledgeBundleRoot(input: {
  bundleId: string;
  knowledgeRoot?: string;
  workspaceId: string;
}): string {
  const root = path.resolve(input.knowledgeRoot ?? getDefaultKnowledgeRoot());
  if (input.bundleId === LOCAL_GENERAL_BUNDLE_ID) return root;
  assertSafeStorageSegment(input.workspaceId);
  assertSafeStorageSegment(input.bundleId);
  return path.join(root, "workspaces", input.workspaceId, "bundles", input.bundleId);
}

export async function scaffoldKnowledgeBundle(input: {
  bundleId: string;
  profile: KnowledgeProfileSchema;
  workspaceId: string;
}): Promise<void> {
  const root = resolveKnowledgeBundleRoot(input);
  await mkdir(root, { recursive: true });
  await Promise.all([
    atomicWrite(path.join(root, "okf-base.yaml"), buildBundleManifest(input.profile)),
    writeIfMissing(path.join(root, "index.md"), "# Knowledge Bundle\n"),
    writeIfMissing(path.join(root, "log.md"), "# Change Log\n"),
    writeIfMissing(
      path.join(root, "source_manifest.md"),
      `---\ntype: source_manifest\ntitle: Source Manifest\nupdated: ${toIsoDate(new Date())}\n---\n\n# Source Manifest\n`,
    ),
  ]);
  await ensureSourceManifestReviewStatus(path.join(root, "source_manifest.md"));
}

export async function writeWorkspaceVault(workspaceId: string): Promise<void> {
  if (process.env.AV_OKF_BACKEND !== "production") return;
  const root = path.resolve(getDefaultKnowledgeRoot());
  const workspaceRoot = path.join(root, "workspaces", workspaceId);
  const bundles = await getPrisma().knowledgeBundle.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
    where: { status: "active", workspaceId },
  });
  await mkdir(workspaceRoot, { recursive: true });
  await atomicWrite(
    path.join(workspaceRoot, "okf-vault.json"),
    `${JSON.stringify({
      bundles: bundles.map((bundle) => ({
        manifest: "okf-base.yaml",
        path: `bundles/${bundle.id}`,
      })),
      name: "AV-OKF Workspace Vault",
      okf_vault_version: "0.1",
    }, null, 2)}\n`,
  );
}

export async function createKnowledgeProfileDraft(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  profile: KnowledgeProfileSchema;
}): Promise<number> {
  const bundle = await getKnowledgeBundle({ bundleId: input.bundleId, context: input.context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const errors = validateKnowledgeProfile(input.profile);
  if (errors.length > 0) throw new Error(errors[0]);
  const latest = await getPrisma().knowledgeBundleProfileVersion.aggregate({
    _max: { version: true },
    where: { bundleId: input.bundleId },
  });
  const version = (latest._max.version ?? 0) + 1;
  await getPrisma().knowledgeBundleProfileVersion.create({
    data: {
      bundleId: input.bundleId,
      createdBy: input.context.userId,
      schema: input.profile,
      status: "draft",
      templateId: input.profile.id,
      version,
    },
  });
  return version;
}

export async function activateKnowledgeProfileVersion(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  version: number;
}): Promise<void> {
  const bundle = await getKnowledgeBundle({ bundleId: input.bundleId, context: input.context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const draft = await getPrisma().knowledgeBundleProfileVersion.findFirst({
    where: { bundleId: input.bundleId, status: "draft", version: input.version },
  });
  if (!draft) throw new Error("knowledge_profile_draft_not_found");
  const profile = draft.schema as unknown as KnowledgeProfileSchema;
  const root = resolveKnowledgeBundleRoot({
    bundleId: input.bundleId,
    workspaceId: input.context.workspaceId,
  });
  const errors = await validateBundleFilesAgainstProfile(root, profile);
  errors.push(...await validateExistingTypeFolders(root, bundle.profile, profile));
  if (errors.length > 0) throw new Error(`knowledge_profile_activation_failed:${errors.join(",")}`);

  await atomicWrite(path.join(root, "okf-base.yaml"), buildBundleManifest(profile));
  await getPrisma().$transaction(async (tx) => {
    await tx.knowledgeBundleProfileVersion.updateMany({
      data: { status: "superseded" },
      where: { bundleId: input.bundleId, status: "active" },
    });
    await tx.knowledgeBundleProfileVersion.update({
      data: { activatedAt: new Date(), status: "active" },
      where: { id: draft.id },
    });
    await tx.knowledgeBundle.update({
      data: { activeProfileVersionId: draft.id },
      where: { id: input.bundleId },
    });
  });
}

async function validateExistingTypeFolders(
  root: string,
  current: KnowledgeProfileSchema,
  next: KnowledgeProfileSchema,
): Promise<string[]> {
  const errors: string[] = [];
  for (const file of await collectMarkdownFiles(root, root)) {
    if (["index.md", "log.md", "source_manifest.md"].includes(file)) continue;
    const parsed = parseOkfMarkdown(await readFile(path.join(root, file), "utf8"));
    const type = typeof parsed.frontmatter.type === "string" ? parsed.frontmatter.type : "";
    if (!type || !current.types[type] || !next.types[type]) continue;
    if (getTypeDirectory(current, type) !== getTypeDirectory(next, type)) {
      errors.push(`${file}:type_folder_immutable:${type}`);
    }
  }
  return errors;
}

export function buildBundleManifest(profile: KnowledgeProfileSchema): string {
  const fields = { ...BASE_FIELDS, ...profile.fields };
  const types = {
    source_manifest: { category: "indexes" as const, label: "Source manifest" },
    ...profile.types,
  };
  const requiredFields = Object.entries(fields)
    .filter(([, definition]) => definition.required)
    .map(([field]) => field);
  const optionalFields = Object.entries(fields)
    .filter(([, definition]) => !definition.required)
    .map(([field]) => field);
  const typeLines = Object.keys(types).sort().flatMap((type) => [
    `    ${type}:`,
    "      required:",
    ...requiredFields.map((field) => `      - ${field}`),
    "      optional:",
    ...optionalFields.map((field) => `      - ${field}`),
    "      status_values:",
    "      - raw_extracted",
    "      - needs_ai_cleanup",
    "      - needs_human_review",
    "      - approved",
    "      - rejected",
    "      - deprecated",
  ]);
  return [
    "okf_version: '0.1'",
    "base:",
    `  name: ${yamlQuote(profile.name)}`,
    "  roots:",
    "  - path: .",
    "    exclude_patterns:",
    "    - '**/.DS_Store'",
    "    - '**/README.md'",
    "  reserved_files:",
    "    index: index.md",
    "    log: log.md",
    "  status_field: review_status",
    "  link_resolution:",
    "    external_refs:",
    "    - source_manifest.md",
    "relations:",
    "  allowed:",
    ...profile.relations.map((relation) => `  - ${relation}`),
    "profile:",
    "  date_fields:",
    "  - updated",
    "  - approved_at",
    "  - deprecated_at",
    "  types:",
    ...typeLines,
    "hygiene:",
    "  broken_links: error",
    "  split_candidates: warn",
    "  reserved_files: error",
    "  unknown_fields: error",
    "",
  ].join("\n");
}

async function ensureSourceManifestReviewStatus(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const parsed = parseOkfMarkdown(content);
  if (parsed.frontmatter.review_status !== undefined) return;
  const updated = content.replace(
    /^(---\r?\n(?:.|\r?\n)*?type:\s*[^\r\n]+\r?\n)/,
    "$1review_status: approved\n",
  );
  if (updated === content) throw new Error("source_manifest_frontmatter_invalid");
  await atomicWrite(filePath, updated);
}

async function validateBundleFilesAgainstProfile(
  root: string,
  profile: KnowledgeProfileSchema,
): Promise<string[]> {
  const errors: string[] = [];
  for (const file of await collectMarkdownFiles(root, root)) {
    if (["index.md", "log.md"].includes(file)) continue;
    const parsed = parseOkfMarkdown(await readFile(path.join(root, file), "utf8"));
    const type = typeof parsed.frontmatter.type === "string" ? parsed.frontmatter.type : "";
    if (!profile.types[type]) errors.push(`${file}:type_not_allowed`);
    if (!type) errors.push(`${file}:type_required`);
    for (const [field, definition] of Object.entries(profile.fields)) {
      if (definition.required && parsed.frontmatter[field] === undefined) {
        errors.push(`${file}:missing_${field}`);
      }
    }
  }
  return errors;
}

async function collectMarkdownFiles(root: string, directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(root, entryPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
    }
  }
  return files;
}

function mapBundleRecord(record: {
  activeProfileVersion: { schema: unknown; version: number } | null;
  createdAt: Date;
  description: string;
  id: string;
  name: string;
  slug: string;
  status: string;
  updatedAt: Date;
  workspaceId: string;
}): KnowledgeBundleRecord {
  if (!record.activeProfileVersion) throw new Error("knowledge_bundle_active_profile_missing");
  return {
    activeProfileVersion: record.activeProfileVersion.version,
    createdAt: record.createdAt.toISOString(),
    description: record.description,
    id: record.id,
    name: record.name,
    profile: normalizeKnowledgeProfile(
      record.activeProfileVersion.schema as unknown as KnowledgeProfileSchema,
    ),
    slug: record.slug,
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
    workspaceId: record.workspaceId,
  };
}

function localGeneralBundle(workspaceId: string): KnowledgeBundleRecord {
  return {
    activeProfileVersion: 1,
    createdAt: new Date(0).toISOString(),
    description: "Local compatibility bundle.",
    id: LOCAL_GENERAL_BUNDLE_ID,
    name: "General Knowledge",
    profile: getKnowledgeProfileTemplate("generic"),
    slug: "general",
    status: "active",
    updatedAt: new Date(0).toISOString(),
    workspaceId,
  };
}

function slugifyBundleName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

function assertSafeStorageSegment(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("knowledge_bundle_storage_key_invalid");
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try { await readFile(filePath); } catch { await atomicWrite(filePath, content); }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
