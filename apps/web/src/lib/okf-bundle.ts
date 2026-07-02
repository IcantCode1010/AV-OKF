import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type OkfBundleFile = {
  filename: string;
  reviewStatus: string;
  title: string;
  type: string;
};

export type OkfBundleFileContent = OkfBundleFile & {
  content: string;
};

export function getDefaultKnowledgeRoot(cwd = process.cwd()): string {
  if (process.env.AV_OKF_KNOWLEDGE_ROOT) {
    return path.resolve(process.env.AV_OKF_KNOWLEDGE_ROOT);
  }

  if (path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps") {
    return path.resolve(cwd, "..", "..", "knowledge");
  }

  return path.resolve(cwd, "knowledge");
}

export async function listOkfBundleFiles(
  knowledgeRoot: string,
): Promise<OkfBundleFile[]> {
  const root = path.resolve(knowledgeRoot);
  const entries = await collectMarkdownFiles(root, root);
  const files = await Promise.all(
    entries.map(async (filename) => {
      const content = await readFile(path.join(root, filename), "utf8");
      return {
        filename,
        ...parseOkfFrontmatter(content),
      };
    }),
  );

  return files.sort((left, right) => left.filename.localeCompare(right.filename));
}

export async function readOkfBundleFile(
  knowledgeRoot: string,
  filename: string,
): Promise<OkfBundleFileContent> {
  assertMarkdownFilename(filename);
  const root = path.resolve(knowledgeRoot);
  const target = path.resolve(root, filename);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("okf_preview_path_escapes_root");
  }

  const content = await readFile(target, "utf8");

  return {
    content,
    filename: path.relative(root, target).replaceAll(path.sep, "/"),
    ...parseOkfFrontmatter(content),
  };
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

function parseOkfFrontmatter(content: string) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";

  return {
    reviewStatus: readScalar(frontmatter, "review_status") ?? "unknown",
    title: readScalar(frontmatter, "title") ?? "Untitled",
    type: readScalar(frontmatter, "type") ?? "unknown",
  };
}

function readScalar(frontmatter: string, key: string) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(frontmatter);
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}
