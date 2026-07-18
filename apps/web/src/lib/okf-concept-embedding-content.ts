import { createHash } from "node:crypto";

import {
  getFrontmatterScalar,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";

export function hashOkfSource(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

export function buildOkfConceptEmbeddingText(input: {
  bundleName: string;
  markdown: string;
}) {
  const parsed = parseOkfMarkdown(input.markdown);
  const type = getFrontmatterScalar(parsed.frontmatter, "type") ?? "unknown";
  const title = getFrontmatterScalar(parsed.frontmatter, "title") ?? "";
  const description = getFrontmatterScalar(parsed.frontmatter, "description") ?? "";
  const header = `[Bundle: ${normalizeHeader(input.bundleName)} | Type: ${normalizeHeader(type)}]`;
  return [header, title, description, parsed.body.trim()].filter(Boolean).join("\n");
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "Unknown";
}
