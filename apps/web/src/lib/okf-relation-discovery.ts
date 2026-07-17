import { readFile } from "node:fs/promises";
import path from "node:path";

import { getFrontmatterNumberArray, getFrontmatterScalar, getFrontmatterStringArray, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { getPrisma } from "./prisma.ts";

const STOPWORDS = new Set(["and", "for", "from", "the", "this", "with"]);

export type RelationDiscoveryConcept = {
  filePath: string;
  pages: number[];
  sourceFile: string;
  tags: string[];
  terms: string[];
};

export async function discoverOkfRelationCandidates(input: { knowledgeBundleId: string; workspaceId: string }) {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.knowledgeBundleId, workspaceId: input.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: input.workspaceId });
  const topics = await getPrisma().topicRecord.findMany({
    where: { knowledgeBundleId: bundle.id, reviewStatus: "approved", exportedFilePath: { not: null }, workspaceId: input.workspaceId },
  });
  const concepts = [];
  for (const topic of topics) {
    const filePath = topic.exportedFilePath!;
    const markdown = await readFile(path.join(root, filePath), "utf8").catch(() => null);
    if (!markdown) continue;
    const parsed = parseOkfMarkdown(markdown);
    if (!isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) continue;
    concepts.push({
      filePath,
      pages: getFrontmatterNumberArray(parsed.frontmatter, "source_pages"),
      sourceFile: getFrontmatterScalar(parsed.frontmatter, "source_file") ?? "",
      tags: getFrontmatterStringArray(parsed.frontmatter, "tags"),
      terms: tokenize(`${getFrontmatterScalar(parsed.frontmatter, "title") ?? ""} ${getFrontmatterScalar(parsed.frontmatter, "description") ?? ""}`),
    });
  }

  const candidates = buildDeterministicRelationCandidates(concepts).map((candidate) => ({
    ...candidate,
    knowledgeBundleId: bundle.id,
    workspaceId: input.workspaceId,
  }));
  if (candidates.length > 0) await getPrisma().okfRelationCandidate.createMany({ data: candidates, skipDuplicates: true });
  return { discovered: candidates.length };
}

export function buildDeterministicRelationCandidates(concepts: RelationDiscoveryConcept[]) {
  const candidates: Array<{ reason: string; relation: string; signals: string[]; sourceFile: string; targetFile: string }> = [];
  for (let leftIndex = 0; leftIndex < concepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concepts.length; rightIndex += 1) {
      const left = concepts[leftIndex]!;
      const right = concepts[rightIndex]!;
      const signals: string[] = [];
      if (left.sourceFile && left.sourceFile === right.sourceFile) signals.push("shared_source_file");
      if (intersects(left.tags, right.tags)) signals.push("shared_tags");
      if (intersects(left.terms, right.terms)) signals.push("title_description_overlap");
      if (left.sourceFile === right.sourceFile && pageDistance(left.pages, right.pages) <= 3) signals.push("source_page_proximity");
      if (signals.length < 2) continue;
      candidates.push({
        reason: `Discovered from ${signals.join(", ")}.`,
        relation: signals.includes("source_page_proximity") ? "supports" : "references",
        signals,
        sourceFile: left.filePath,
        targetFile: right.filePath,
      });
    }
  }
  return candidates;
}

export async function listOkfRelationCandidates(input: { knowledgeBundleId: string; workspaceId: string }) {
  return getPrisma().okfRelationCandidate.findMany({
    orderBy: [{ status: "asc" }, { sourceFile: "asc" }, { targetFile: "asc" }],
    where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.workspaceId },
  });
}

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((term) => !STOPWORDS.has(term)) ?? [])];
}
function intersects(left: string[], right: string[]) { const set = new Set(right); return left.some((value) => set.has(value)); }
function pageDistance(left: number[], right: number[]) { return Math.min(...left.flatMap((a) => right.map((b) => Math.abs(a - b))), Number.POSITIVE_INFINITY); }
