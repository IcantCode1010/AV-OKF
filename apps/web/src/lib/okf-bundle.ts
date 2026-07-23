import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getFrontmatterScalar, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
import type { OkfConceptLifecycleRecord } from "./okf-bundle-retriever.ts";

export { getDefaultKnowledgeRoot } from "./knowledge-root.ts";

export type OkfBundleGroup =
  | "fault_route"
  | "other"
  | "reserved"
  | "routing_rule"
  | "system_topic";

export type OkfBundleFile = {
  filename: string;
  group: OkfBundleGroup;
  isReserved: boolean;
  lifecycleReason?: string | null;
  lifecycleStatus?: OkfConceptLifecycleRecord["status"];
  modifiedAt?: string;
  reviewStatus: string;
  title: string;
  type: string;
};

export type OkfBundleFileContent = OkfBundleFile & {
  content: string;
};

export type OkfBundleSummary = {
  defaultFile?: string;
  fileCount: number;
  files: OkfBundleFile[];
  groupCounts: Record<OkfBundleGroup, number>;
  latestModifiedAt?: string;
};

export async function listOkfBundleFiles(
  knowledgeRoot: string,
): Promise<OkfBundleFile[]> {
  const root = path.resolve(knowledgeRoot);
  const entries = await collectMarkdownFiles(root, root);
  const files = await Promise.all(
    entries.map(async (filename) => {
      const filePath = path.join(root, filename);
      const [content, fileStat] = await Promise.all([
        readFile(filePath, "utf8"),
        stat(filePath),
      ]);
      const frontmatter = parseOkfFrontmatter(content, filename);
      return {
        filename,
        group: getBundleFileGroup(filename, frontmatter.type),
        isReserved: isReservedBundleFile(filename),
        modifiedAt: fileStat.mtime.toISOString(),
        ...frontmatter,
      };
    }),
  );

  return files.sort((left, right) => left.filename.localeCompare(right.filename));
}

export async function getOkfBundleSummary(
  knowledgeRoot: string,
): Promise<OkfBundleSummary> {
  let files: OkfBundleFile[];

  try {
    files = await listOkfBundleFiles(knowledgeRoot);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      files = [];
    } else {
      throw error;
    }
  }

  return {
    defaultFile: getDefaultBundleFile(files),
    fileCount: files.length,
    files,
    groupCounts: getGroupCounts(files),
    latestModifiedAt: getLatestModifiedAt(files),
  };
}

export async function readOkfBundleFile(
  knowledgeRoot: string,
  filename: string,
): Promise<OkfBundleFileContent> {
  assertMarkdownFilename(filename);
  const root = path.resolve(knowledgeRoot);
  const target = await resolveKnowledgePath({
    knowledgeRoot: root,
    relativePath: filename,
  });

  if (!target) {
    throw new Error("okf_preview_path_escapes_root");
  }

  const content = await readFile(target, "utf8");
  const filenameInBundle = path.relative(root, target).replaceAll(path.sep, "/");
  const frontmatter = parseOkfFrontmatter(content, filenameInBundle);

  return {
    content,
    filename: filenameInBundle,
    group: getBundleFileGroup(filenameInBundle, frontmatter.type),
    isReserved: isReservedBundleFile(filenameInBundle),
    ...frontmatter,
  };
}

export function applyOkfBundleLifecycle<T extends OkfBundleFile>(
  files: T[],
  lifecycleByFile: Map<string, OkfConceptLifecycleRecord>,
): T[] {
  return files.map((file) => {
    const lifecycle = lifecycleByFile.get(file.filename) ?? { status: "active" as const };

    return {
      ...file,
      lifecycleReason: lifecycle.reason,
      lifecycleStatus: lifecycle.status,
    };
  });
}

export function getBundleFileGroup(
  filename: string,
  type: string,
): OkfBundleGroup {
  if (isReservedBundleFile(filename)) {
    return "reserved";
  }

  if (type === "system_topic") {
    return "system_topic";
  }

  if (type === "fault_route") {
    return "fault_route";
  }

  if (type === "routing_rule") {
    return "routing_rule";
  }

  return "other";
}

async function collectMarkdownFiles(root: string, directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(root, entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
    }
  }

  return files;
}

function assertMarkdownFilename(filename: string) {
  if (!filename.endsWith(".md")) {
    throw new Error("okf_preview_only_markdown");
  }
}

function getDefaultBundleFile(files: OkfBundleFile[]) {
  return (
    files.find((file) => file.filename === "index.md")?.filename ??
    files.find((file) => file.group === "system_topic")?.filename ??
    files[0]?.filename
  );
}

function getGroupCounts(files: OkfBundleFile[]) {
  const counts: Record<OkfBundleGroup, number> = {
    fault_route: 0,
    other: 0,
    reserved: 0,
    routing_rule: 0,
    system_topic: 0,
  };

  for (const file of files) {
    counts[file.group] += 1;
  }

  return counts;
}

function getLatestModifiedAt(files: OkfBundleFile[]) {
  return files
    .map((file) => file.modifiedAt)
    .filter((modifiedAt): modifiedAt is string => Boolean(modifiedAt))
    .sort()
    .at(-1);
}

function isMissingDirectoryError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isReservedBundleFile(filename: string) {
  return ["index.md", "log.md", "source_manifest.md"].includes(filename);
}

function parseOkfFrontmatter(content: string, filename: string) {
  const { frontmatter } = parseOkfMarkdown(content);

  return {
    reviewStatus: getFrontmatterScalar(frontmatter, "review_status") ?? "unknown",
    title:
      getFrontmatterScalar(frontmatter, "title") ??
      getReservedFileTitle(filename) ??
      "Untitled",
    type: getFrontmatterScalar(frontmatter, "type") ?? "unknown",
  };
}

function getReservedFileTitle(filename: string) {
  const titles: Record<string, string> = {
    "index.md": "Bundle Index",
    "log.md": "Activity Log",
    "source_manifest.md": "Source Manifest",
  };

  return titles[filename];
}
