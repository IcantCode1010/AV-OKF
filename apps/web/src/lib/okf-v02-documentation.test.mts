import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const documentationRoots = [
  path.join(repositoryRoot, "README.md"),
  path.join(repositoryRoot, "docs", "architecture"),
  path.join(repositoryRoot, "docs", "user-guides"),
];

const historicalSourceManifestDocuments = new Set([
  "docs/architecture/okf-v0.2-adoption.md",
]);

const forbiddenLegacyPatterns = [
  { code: "okf_v01_version_example", pattern: /^\s*okf_version:\s*["']?0\.1["']?\s*$/mu },
  { code: "legacy_review_status", pattern: /^\s*review_status:\s*/mu },
  { code: "legacy_approved_by", pattern: /^\s*approved_by:\s*/mu },
  { code: "legacy_approved_at", pattern: /^\s*approved_at:\s*/mu },
  { code: "legacy_source_file", pattern: /^\s*source_file:\s*/mu },
  { code: "legacy_updated", pattern: /^\s*updated:\s*/mu },
  { code: "legacy_citations_heading", pattern: /^# Citations\s*$/mu },
];

test("active documentation contains no v0.1 OKF contract examples", async () => {
  const markdownFiles = (
    await Promise.all(documentationRoots.map(listMarkdownFiles))
  ).flat().sort();
  const violations: string[] = [];

  for (const filePath of markdownFiles) {
    const relativePath = path.relative(repositoryRoot, filePath).replaceAll("\\", "/");
    const content = await readFile(filePath, "utf8");
    for (const rule of forbiddenLegacyPatterns) {
      if (rule.pattern.test(content)) {
        violations.push(`${relativePath}: ${rule.code}`);
      }
    }
    if (
      content.includes("source_manifest.md") &&
      !historicalSourceManifestDocuments.has(relativePath)
    ) {
      violations.push(`${relativePath}: legacy_source_manifest`);
    }
  }

  assert.deepEqual(violations, []);
});

test("the document walkthrough declares the current v0.2 trust and source contract", async () => {
  const walkthrough = await readFile(
    path.join(repositoryRoot, "docs", "user-guides", "file-processing-walkthrough.md"),
    "utf8",
  );

  assert.match(walkthrough, /okf_version: "0\.2"/u);
  assert.match(walkthrough, /^generated:$/mu);
  assert.match(walkthrough, /^verified:$/mu);
  assert.match(walkthrough, /^sources:$/mu);
  assert.match(walkthrough, /^status: "stable"$/mu);
  assert.match(walkthrough, /references\/sources\/source-document-/u);
});

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) {
    return rootPath.endsWith(".md") ? [rootPath] : [];
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  }));
  return nested.flat();
}
