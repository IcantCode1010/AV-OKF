import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateOkfRelationDiscovery,
  evaluateRelationDiscoveryCandidates,
} from "../src/lib/okf-relation-discovery.ts";
import { getKnowledgeProfileTemplate } from "../src/lib/knowledge-profile.ts";
import { getPrisma } from "../src/lib/prisma.ts";

const workspaceId = process.env.RELATION_EVAL_WORKSPACE_ID?.trim();
if (!workspaceId) throw new Error("RELATION_EVAL_WORKSPACE_ID is required");

const requestedBundleIds = new Set(
  (process.env.RELATION_EVAL_BUNDLE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const bundles = await getPrisma().knowledgeBundle.findMany({
  orderBy: [{ name: "asc" }, { id: "asc" }],
  where: {
    id: requestedBundleIds.size > 0 ? { in: [...requestedBundleIds] } : undefined,
    status: "active",
    workspaceId,
  },
});
if (bundles.length === 0) throw new Error("relation_evaluation_requires_active_bundle");

const results = [];
for (const bundle of bundles) {
  const evaluation = await evaluateOkfRelationDiscovery({
    knowledgeBundleId: bundle.id,
    workspaceId,
  });
  results.push({
    ...evaluation,
    after: {
      ...evaluation.after,
      accepted: evaluation.after.accepted.map(summarizeCandidate),
      qualityFiltered: evaluation.after.qualityFiltered.map((entry) => ({
        ...entry,
        candidate: summarizeCandidate(entry.candidate),
      })),
      suppressed: evaluation.after.suppressed.map((entry) => ({
        ...entry,
        candidate: summarizeCandidate(entry.candidate),
      })),
    },
    before: {
      ...evaluation.before,
      candidates: evaluation.before.candidates.map(summarizeCandidate),
    },
    humanReview: {
      acceptanceRate: null,
      directionCorrections: null,
      falsePositives: null,
      missedRelations: null,
      status: "pending_reviewer_sample",
    },
  });
}

const report = {
  fixtureResults: buildMixedDomainFixtureResults(),
  generatedAt: new Date().toISOString(),
  notes: [
    "Before reproduces the prior two-signal heuristic.",
    "After applies profile stopwords, two-term overlap, stable direction, and shared graph preflight.",
    "Human review fields must be completed before deciding on semantic or broader LLM relation discovery.",
  ],
  results,
  workspaceId,
};
const outputPath = path.resolve(
  process.env.RELATION_EVAL_OUTPUT_PATH ??
    path.join(process.cwd(), "..", "..", "docs", "debug", `relation-discovery-v2-${new Date().toISOString().slice(0, 10)}.json`),
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ bundles: results.length, outputPath }, null, 2));

function summarizeCandidate(candidate: {
  reason: string;
  relation: string;
  signals: string[];
  sourceFile: string;
  targetFile: string;
}) {
  return {
    direction: `${candidate.sourceFile} -> ${candidate.targetFile}`,
    matchedTags: candidate.signals.filter((signal) => signal.startsWith("matched_tag:")).map(stripSignalPrefix),
    matchedTerms: candidate.signals.filter((signal) => signal.startsWith("matched_term:")).map(stripSignalPrefix),
    reason: candidate.reason,
    relation: candidate.relation,
    signals: candidate.signals,
    sourceFile: candidate.sourceFile,
    targetFile: candidate.targetFile,
    warnings: candidate.signals.filter((signal) => signal.startsWith("preflight_warning:")),
  };
}

function stripSignalPrefix(signal: string) {
  return signal.slice(signal.indexOf(":") + 1);
}

function buildMixedDomainFixtureResults() {
  const generic = getKnowledgeProfileTemplate("generic");
  const aviation = getKnowledgeProfileTemplate("aviation");
  const genericConcepts = [
    { filePath: "concepts/system/brake-inspection.md", pages: [10], sourceFile: "vehicle-guide.pdf", tags: [], terms: ["brake", "inspection", "vehicle"] },
    { filePath: "concepts/system/brake-pressure.md", pages: [30], sourceFile: "vehicle-guide.pdf", tags: [], terms: ["brake", "pressure", "vehicle"] },
  ];
  const aviationConcepts = [
    { filePath: "concepts/system/brake-pressure.md", pages: [10], sourceFile: "flight-manual.pdf", tags: [], terms: ["aircraft", "brake", "operation", "pressure"] },
    { filePath: "concepts/system/hydraulic-pressure.md", pages: [30], sourceFile: "flight-manual.pdf", tags: [], terms: ["aircraft", "hydraulic", "operation", "pressure"] },
  ];
  return [
    {
      bundle: { name: "Generic deterministic fixture", profileId: generic.id },
      ...evaluateRelationDiscoveryCandidates({
        concepts: genericConcepts,
        context: fixtureContext(genericConcepts.map((concept) => concept.filePath), generic.relations),
        stopwords: generic.relationDiscovery.stopwords,
      }),
    },
    {
      bundle: { name: "Aviation deterministic fixture", profileId: aviation.id },
      ...evaluateRelationDiscoveryCandidates({
        concepts: aviationConcepts,
        context: fixtureContext(aviationConcepts.map((concept) => concept.filePath), aviation.relations),
        stopwords: aviation.relationDiscovery.stopwords,
      }),
    },
  ].map((entry) => ({
    ...entry,
    after: {
      ...entry.after,
      accepted: entry.after.accepted.map(summarizeCandidate),
      qualityFiltered: entry.after.qualityFiltered.map((filtered) => ({
        ...filtered,
        candidate: summarizeCandidate(filtered.candidate),
      })),
      suppressed: entry.after.suppressed.map((suppression) => ({
        ...suppression,
        candidate: summarizeCandidate(suppression.candidate),
      })),
    },
    before: {
      ...entry.before,
      candidates: entry.before.candidates.map(summarizeCandidate),
    },
  }));
}

function fixtureContext(filePaths: string[], allowedRelations: string[]) {
  return {
    activeFiles: filePaths.map((filePath) => ({ filePath, type: "system" })),
    allowedRelations,
    existingEdges: [],
  };
}
