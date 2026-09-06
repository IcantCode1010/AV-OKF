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
import { inspectOkfV02ClaimAttribution } from "./okf-v02-claim-attribution.ts";

export type OkfV02ValidationIssue = {
  code: string;
  filePath: string;
  message: string;
};

export async function validatePortableOkfV02BundleRoot(
  knowledgeRoot: string,
): Promise<OkfV02ValidationIssue[]> {
  const issues: OkfV02ValidationIssue[] = [];
  const files = await collectMarkdownFiles(knowledgeRoot);

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

    const reservedName = path.posix.basename(filePath).toLowerCase();
    if (reservedName === "index.md") {
      const keys = Object.keys(parsed.frontmatter);
      if (filePath !== "index.md" && keys.length > 0) {
        issues.push(issue(
          filePath,
          "okf_v02_index_frontmatter_forbidden",
          "Only the bundle-root index.md may contain frontmatter.",
        ));
      } else if (filePath === "index.md") {
        if (keys.some((key) => key !== "okf_version")) {
          issues.push(issue(
            filePath,
            "okf_v02_index_frontmatter_forbidden",
            "Root index.md frontmatter may contain only okf_version.",
          ));
        }
        if (
          parsed.frontmatter.okf_version !== undefined &&
          parsed.frontmatter.okf_version !== "0.2"
        ) {
          issues.push(issue(
            filePath,
            "okf_v02_version_unsupported",
            "Declared OKF version is not 0.2.",
          ));
        }
      }
      continue;
    }

    if (reservedName === "log.md") {
      for (const heading of parsed.body.matchAll(/^##\s+(.+?)\s*$/gm)) {
        const value = heading[1] ?? "";
        if (!isIsoDate(value)) {
          issues.push(issue(
            filePath,
            "okf_v02_log_date_invalid",
            `Log date heading is not YYYY-MM-DD: ${value}`,
          ));
        }
      }
      continue;
    }

    for (const code of validateOkfV02Frontmatter(parsed.frontmatter)) {
      issues.push(issue(filePath, code, code));
    }
  }

  return sortIssues(issues);
}

export async function validateOkfV02BundleRoot(
  knowledgeRoot: string,
): Promise<OkfV02ValidationIssue[]> {
  const issues = await validatePortableOkfV02BundleRoot(knowledgeRoot);
  const files = await collectMarkdownFiles(knowledgeRoot);
  const paths = new Set(files);
  if (!paths.has("index.md")) {
    issues.push(issue("index.md", "okf_v02_index_missing", "Root index.md is required."));
    return sortIssues(issues);
  }

  try {
    const rootIndexPath = await resolveKnowledgePath({
      knowledgeRoot,
      relativePath: "index.md",
    });
    const rootIndex = rootIndexPath
      ? parseOkfMarkdown(await readFile(rootIndexPath, "utf8"))
      : null;
    if (rootIndex?.frontmatter.okf_version !== "0.2") {
      issues.push(issue(
        "index.md",
        "okf_v02_version_missing",
        "index.md must declare okf_version: 0.2.",
      ));
    }
  } catch {
    // Portable validation already reports the parse or path error.
  }

  for (const filePath of files) {
    const reservedName = path.posix.basename(filePath).toLowerCase();
    if (reservedName === "index.md" || reservedName === "log.md") continue;
    const fullPath = await resolveKnowledgePath({ knowledgeRoot, relativePath: filePath });
    if (!fullPath) continue;
    let parsed;
    try {
      parsed = parseOkfMarkdown(await readFile(fullPath, "utf8"));
    } catch {
      // Portable validation already reports malformed frontmatter.
      continue;
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
    for (const claimIssue of inspectOkfV02ClaimAttribution({
      body: parsed.body,
      sources: getFrontmatterSources(parsed.frontmatter),
    }).issues) {
      issues.push(issue(filePath, claimIssue.code, claimIssue.message));
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
  return sortIssues(issues);
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

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function sortIssues(issues: OkfV02ValidationIssue[]) {
  return issues.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) || left.code.localeCompare(right.code),
  );
}
