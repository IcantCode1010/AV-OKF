import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  getFrontmatterRelations,
  getFrontmatterScalar,
  getFrontmatterSources,
  isOkfV02Current,
  parseOkfMarkdown,
  validateOkfV02Frontmatter,
} from "./okf-frontmatter.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";

export type OkfV02ValidationIssue = {
  code: string;
  filePath: string;
  message: string;
};

export async function validateOkfV02BundleRoot(
  knowledgeRoot: string,
): Promise<OkfV02ValidationIssue[]> {
  const issues: OkfV02ValidationIssue[] = [];
  const files = await collectMarkdownFiles(knowledgeRoot);
  const paths = new Set(files);
  if (!paths.has("index.md")) {
    issues.push(issue("index.md", "okf_v02_index_missing", "Root index.md is required."));
    return issues;
  }

  for (const filePath of files) {
    const fullPath = await resolveKnowledgePath({ knowledgeRoot, relativePath: filePath });
    if (!fullPath) {
      issues.push(issue(filePath, "okf_v02_path_unsafe", "File resolves outside the bundle."));
      continue;
    }
    let parsed;
    try {
      parsed = parseOkfMarkdown(await readFile(fullPath, "utf8"));
    } catch (error) {
      issues.push(issue(
        filePath,
        "okf_v02_frontmatter_invalid",
        error instanceof Error ? error.message : String(error),
      ));
      continue;
    }
    if (filePath === "log.md") continue;
    if (filePath === "index.md") {
      if (parsed.frontmatter.okf_version !== "0.2") {
        issues.push(issue(filePath, "okf_v02_version_missing", "index.md must declare okf_version: 0.2."));
      }
      if (Object.keys(parsed.frontmatter).some((key) => key !== "okf_version")) {
        issues.push(issue(
          filePath,
          "okf_v02_index_frontmatter_forbidden",
          "index.md frontmatter may contain only okf_version.",
        ));
      }
      continue;
    }
    for (const code of validateOkfV02Frontmatter(parsed.frontmatter)) {
      issues.push(issue(filePath, code, code));
    }
    for (const relation of getFrontmatterRelations(parsed.frontmatter)) {
      const target = normalizeRelationTarget(filePath, relation.target);
      if (!target) {
        issues.push(issue(filePath, "okf_v02_relation_target_unsafe", `Relation target is unsafe: ${relation.target}`));
        continue;
      }
      if (!paths.has(target)) {
        issues.push(issue(filePath, "okf_v02_relation_target_missing", `Relation target is missing: ${relation.target}`));
        continue;
      }
      const targetPath = await resolveKnowledgePath({ knowledgeRoot, relativePath: target });
      if (!targetPath) {
        issues.push(issue(filePath, "okf_v02_relation_target_unsafe", "Relation target resolves outside the bundle."));
        continue;
      }
      try {
        const targetFrontmatter = parseOkfMarkdown(await readFile(targetPath, "utf8")).frontmatter;
        if (relation.targetType && relation.targetType !== getFrontmatterScalar(targetFrontmatter, "type")) {
          issues.push(issue(filePath, "okf_v02_relation_target_type_mismatch", `Relation target type does not match: ${relation.target}`));
        }
      } catch (error) {
        issues.push(issue(filePath, "okf_v02_relation_target_invalid", error instanceof Error ? error.message : String(error)));
      }
    }
    if (parsed.frontmatter.av_okf_role === "source_document") continue;
    if (isOkfV02Current(parsed.frontmatter) && parsed.frontmatter.verified) {
      for (const source of getFrontmatterSources(parsed.frontmatter)) {
        if (!source.resource.startsWith("/")) continue;
        const target = normalizeResource(source.resource);
        if (!target || !paths.has(target)) {
          issues.push(issue(
            filePath,
            "okf_v02_source_reference_missing",
            `Source reference is missing: ${source.resource}`,
          ));
        }
      }
    }
  }
  return issues.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) || left.code.localeCompare(right.code),
  );
}

async function collectMarkdownFiles(root: string) {
  const result: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        result.push(path.relative(root, fullPath).replaceAll("\\", "/"));
      }
    }
  }
  await walk(root);
  return result.sort();
}

function normalizeResource(value: string) {
  const decoded = decodeURIComponent(value).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!decoded || decoded.split("/").includes("..") || path.posix.isAbsolute(decoded)) return null;
  const normalized = path.posix.normalize(decoded);
  return normalized.startsWith("../") ? null : normalized;
}

function normalizeRelationTarget(sourcePath: string, value: string) {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  if (
    !decoded ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) ||
    path.posix.isAbsolute(decoded)
  ) return null;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded));
  if (!normalized.endsWith(".md") || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function issue(filePath: string, code: string, message: string): OkfV02ValidationIssue {
  return { code, filePath, message };
}
