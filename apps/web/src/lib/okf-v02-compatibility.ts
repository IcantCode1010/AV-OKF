import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parseOkfMarkdown,
  serializeOkfMarkdown,
  validateOkfV02Frontmatter,
} from "./okf-frontmatter.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import {
  validateOkfV02BundleRoot,
  validatePortableOkfV02BundleRoot,
} from "./okf-v02-validation.ts";

export type OkfV02CompatibilityManifest = {
  schemaVersion: 1;
  source: {
    commit: string;
    license: { name: string; path: string; sha256: string };
    repository: string;
  };
  expected: CompatibilityCounts;
  bundles: Array<{
    expected: CompatibilityCounts;
    name: string;
    path: string;
  }>;
  files: Array<{ path: string; sha256: string }>;
};

export type CompatibilityCounts = {
  bundleFiles: number;
  conceptFiles: number;
  indexFiles: number;
  logFiles: number;
  markdownFiles: number;
  resourceFiles: number;
};

export async function loadOkfV02CompatibilityManifest(
  corpusRoot: string,
): Promise<OkfV02CompatibilityManifest> {
  const parsed = JSON.parse(
    await readFile(path.join(corpusRoot, "manifest.json"), "utf8"),
  ) as OkfV02CompatibilityManifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.bundles) || !Array.isArray(parsed.files)) {
    throw new Error("okf_v02_compatibility_manifest_invalid");
  }
  return parsed;
}

export async function buildOkfV02CompatibilityReport(input: {
  corpusRoot: string;
  manifest?: OkfV02CompatibilityManifest;
}) {
  const manifest = input.manifest ??
    await loadOkfV02CompatibilityManifest(input.corpusRoot);
  const integrityMismatches = await verifyCorpusIntegrity(input.corpusRoot, manifest);
  const bundles = [];

  for (const bundle of manifest.bundles) {
    const bundleRoot = path.join(input.corpusRoot, ...bundle.path.split("/"));
    const files = await collectFiles(bundleRoot);
    const markdownFiles = files.filter((file) => file.toLowerCase().endsWith(".md"));
    const typeCounts = new Map<string, number>();
    const fieldCounts = new Map<string, number>();
    const roundTripFailures: string[] = [];
    const conceptValidationIssues: Array<{ codes: string[]; filePath: string }> = [];
    let agentReadyConcepts = 0;
    let conceptFiles = 0;
    let indexFiles = 0;
    let logFiles = 0;

    for (const file of markdownFiles) {
      const relativePath = path.relative(bundleRoot, file).replaceAll("\\", "/");
      const basename = path.posix.basename(relativePath).toLowerCase();
      const markdown = await readFile(file, "utf8");
      const roundTrip = evaluateOkfMarkdownRoundTrip(markdown);
      if (!roundTrip.valid) roundTripFailures.push(relativePath);
      const parsed = parseOkfMarkdown(markdown);

      if (basename === "index.md") {
        indexFiles += 1;
        continue;
      }
      if (basename === "log.md") {
        logFiles += 1;
        continue;
      }

      conceptFiles += 1;
      const issues = validateOkfV02Frontmatter(parsed.frontmatter);
      if (issues.length > 0) {
        conceptValidationIssues.push({ codes: [...issues].sort(), filePath: relativePath });
      }
      const type = typeof parsed.frontmatter.type === "string"
        ? parsed.frontmatter.type.trim()
        : "<missing>";
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      for (const field of Object.keys(parsed.frontmatter)) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
      if (isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) {
        agentReadyConcepts += 1;
      }
    }

    const counts: CompatibilityCounts = {
      bundleFiles: files.length,
      conceptFiles,
      indexFiles,
      logFiles,
      markdownFiles: markdownFiles.length,
      resourceFiles: files.length - markdownFiles.length,
    };
    const portableIssues = await validatePortableOkfV02BundleRoot(bundleRoot);
    const runtimeIssues = await validateOkfV02BundleRoot(bundleRoot);
    const warnings = await collectMarkdownLinkWarnings(bundleRoot, markdownFiles);
    bundles.push({
      agentReadyConcepts,
      conceptValidationIssues,
      counts,
      expectedCounts: bundle.expected,
      fields: sortedRecord(fieldCounts),
      name: bundle.name,
      portableCompatible: portableIssues.length === 0,
      portableIssues,
      roundTripFailures: roundTripFailures.sort(),
      roundTripsPassed: markdownFiles.length - roundTripFailures.length,
      runtimeIssues,
      runtimeReady: runtimeIssues.length === 0,
      types: sortedRecord(typeCounts),
      warnings,
    });
  }

  const totals = bundles.reduce<CompatibilityCounts>((result, bundle) => ({
    bundleFiles: result.bundleFiles + bundle.counts.bundleFiles,
    conceptFiles: result.conceptFiles + bundle.counts.conceptFiles,
    indexFiles: result.indexFiles + bundle.counts.indexFiles,
    logFiles: result.logFiles + bundle.counts.logFiles,
    markdownFiles: result.markdownFiles + bundle.counts.markdownFiles,
    resourceFiles: result.resourceFiles + bundle.counts.resourceFiles,
  }), emptyCounts());
  addCountMismatches(integrityMismatches, "totals", totals, manifest.expected);
  for (const bundle of bundles) {
    addCountMismatches(
      integrityMismatches,
      `bundle:${bundle.name}`,
      bundle.counts,
      bundle.expectedCounts,
    );
  }
  integrityMismatches.sort();

  return {
    schemaVersion: 1 as const,
    corpus: {
      commit: manifest.source.commit,
      license: manifest.source.license.name,
      repository: manifest.source.repository,
    },
    integrity: {
      mismatches: integrityMismatches,
      valid: integrityMismatches.length === 0,
    },
    expectedTotals: manifest.expected,
    totals,
    summary: {
      agentReadyConcepts: bundles.reduce((sum, bundle) => sum + bundle.agentReadyConcepts, 0),
      conceptValidationFailures: bundles.reduce(
        (sum, bundle) => sum + bundle.conceptValidationIssues.length,
        0,
      ),
      portableCompatibleBundles: bundles.filter((bundle) => bundle.portableCompatible).length,
      roundTripsPassed: bundles.reduce((sum, bundle) => sum + bundle.roundTripsPassed, 0),
      runtimeReadyBundles: bundles.filter((bundle) => bundle.runtimeReady).length,
      warnings: bundles.reduce((sum, bundle) => sum + bundle.warnings.length, 0),
    },
    bundles,
  };
}

export function evaluateOkfMarkdownRoundTrip(markdown: string) {
  try {
    const first = parseOkfMarkdown(markdown);
    const canonical = serializeOkfMarkdown(first);
    const second = parseOkfMarkdown(canonical);
    return {
      valid:
        isDeepStrictEqual(second.frontmatter, first.frontmatter) &&
        normalizeBody(second.body) === normalizeBody(first.body) &&
        serializeOkfMarkdown(second) === canonical,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      valid: false,
    };
  }
}

async function verifyCorpusIntegrity(
  corpusRoot: string,
  manifest: OkfV02CompatibilityManifest,
) {
  const mismatches: string[] = [];
  const expectedPaths = new Set(manifest.files.map((file) => file.path));
  const bundleRoot = path.join(corpusRoot, "okf", "bundles");
  const actualPaths = (await collectFiles(bundleRoot))
    .map((file) => path.relative(corpusRoot, file).replaceAll("\\", "/"));

  for (const actualPath of actualPaths) {
    if (!expectedPaths.has(actualPath)) mismatches.push(`unexpected:${actualPath}`);
  }
  for (const file of manifest.files) {
    try {
      const digest = sha256(await readFile(path.join(corpusRoot, ...file.path.split("/"))));
      if (digest !== file.sha256) mismatches.push(`hash:${file.path}`);
    } catch {
      mismatches.push(`missing:${file.path}`);
    }
  }
  try {
    const licenseDigest = sha256(await readFile(
      path.join(corpusRoot, ...manifest.source.license.path.split("/")),
    ));
    if (licenseDigest !== manifest.source.license.sha256) {
      mismatches.push(`hash:${manifest.source.license.path}`);
    }
  } catch {
    mismatches.push(`missing:${manifest.source.license.path}`);
  }
  return mismatches.sort();
}

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownLinkWarnings(bundleRoot: string, files: string[]) {
  const bundleFiles = new Set(
    (await collectFiles(bundleRoot)).map((file) =>
      path.relative(bundleRoot, file).replaceAll("\\", "/")
    ),
  );
  const warnings: Array<{ code: string; filePath: string; target: string }> = [];

  for (const file of files) {
    const filePath = path.relative(bundleRoot, file).replaceAll("\\", "/");
    const markdown = await readFile(file, "utf8");
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = (match[1] ?? "").trim().replace(/^<|>$/g, "");
      if (
        !target ||
        target.startsWith("#") ||
        target.startsWith("//") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
      ) continue;
      const rawPath = target.split(/[?#]/, 1)[0] ?? "";
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        warnings.push({ code: "okf_v02_link_unsafe", filePath, target });
        continue;
      }
      if (decoded.includes("\\") || decoded.includes("\0")) {
        warnings.push({ code: "okf_v02_link_unsafe", filePath, target });
        continue;
      }
      const joined = decoded.startsWith("/")
        ? decoded.replace(/^\/+/, "")
        : path.posix.join(path.posix.dirname(filePath), decoded);
      const normalized = path.posix.normalize(joined);
      if (!normalized || normalized === ".." || normalized.startsWith("../")) {
        warnings.push({ code: "okf_v02_link_unsafe", filePath, target });
        continue;
      }
      const resolved = decoded.endsWith("/")
        ? path.posix.join(normalized, "index.md")
        : normalized;
      if (!bundleFiles.has(resolved)) {
        warnings.push({ code: "okf_v02_link_missing", filePath, target });
      }
    }
  }
  return warnings.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) || left.target.localeCompare(right.target)
  );
}

function normalizeBody(body: string) {
  return body.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedRecord(values: Map<string, number>) {
  return Object.fromEntries(
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function emptyCounts(): CompatibilityCounts {
  return {
    bundleFiles: 0,
    conceptFiles: 0,
    indexFiles: 0,
    logFiles: 0,
    markdownFiles: 0,
    resourceFiles: 0,
  };
}

function addCountMismatches(
  mismatches: string[],
  scope: string,
  actual: CompatibilityCounts,
  expected: CompatibilityCounts,
) {
  for (const key of Object.keys(expected) as Array<keyof CompatibilityCounts>) {
    if (actual[key] !== expected[key]) {
      mismatches.push(`count:${scope}:${key}:${actual[key]}!=${expected[key]}`);
    }
  }
}
