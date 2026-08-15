import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeterministicRelationCandidates,
  buildSemanticRelationCandidates,
} from "./okf-relation-discovery.ts";

test("relation discovery requires multiple deterministic signals and stays review-only", () => {
  const candidates = buildDeterministicRelationCandidates([
    { filePath: "concepts/system/brakes.md", pages: [10], sourceFile: "manual.pdf", tags: ["safety"], terms: ["brake", "inspection"] },
    { filePath: "procedures/procedure/prestart.md", pages: [12], sourceFile: "manual.pdf", tags: ["safety"], terms: ["vehicle", "inspection"] },
    { filePath: "concepts/system/unrelated.md", pages: [80], sourceFile: "other.pdf", tags: ["finance"], terms: ["invoice"] },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.relation, "supports");
  assert.deepEqual(candidates[0]?.signals, [
    "shared_source_file",
    "shared_tags",
    "source_page_proximity",
    "matched_term:inspection",
    "matched_tag:safety",
  ]);
  assert.match(candidates[0]?.reason ?? "", /shared tags \(safety\)/);
  assert.equal("status" in (candidates[0] ?? {}), false);
});

test("semantic expansion proposes only cross-document pairs and keeps similarity evidence", () => {
  const concepts = [
    { contentHash: "a", filePath: "concepts/a.md", pages: [1], sourceFile: "references/sources/a.md", tags: [], terms: [] },
    { contentHash: "b", filePath: "concepts/b.md", pages: [2], sourceFile: "references/sources/a.md", tags: [], terms: [] },
    { contentHash: "c", filePath: "concepts/c.md", pages: [3], sourceFile: "references/sources/c.md", tags: [], terms: [] },
  ];
  const candidates = buildSemanticRelationCandidates(concepts, [
    { score: 0.91, sourceFile: "concepts/a.md", targetFile: "concepts/b.md" },
    { score: 0.82, sourceFile: "concepts/a.md", targetFile: "concepts/c.md" },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.targetFile, "concepts/c.md");
  assert.deepEqual(candidates[0]?.signals, [
    "semantic_neighbor",
    "semantic_similarity:0.820",
  ]);
});

test("one shared term does not qualify but two meaningful terms do", () => {
  const oneTerm = buildDeterministicRelationCandidates([
    { filePath: "concepts/a.md", pages: [1], sourceFile: "manual.pdf", tags: [], terms: ["brake", "inspection"] },
    { filePath: "concepts/b.md", pages: [20], sourceFile: "manual.pdf", tags: [], terms: ["brake", "pressure"] },
  ]);
  assert.deepEqual(oneTerm, []);

  const twoTerms = buildDeterministicRelationCandidates([
    { filePath: "concepts/a.md", pages: [1], sourceFile: "manual.pdf", tags: [], terms: ["brake", "inspection"] },
    { filePath: "concepts/b.md", pages: [20], sourceFile: "manual.pdf", tags: [], terms: ["inspection", "brake"] },
  ]);
  assert.equal(twoTerms.length, 1);
  assert.deepEqual(twoTerms[0]?.signals, [
    "shared_source_file",
    "title_description_overlap",
    "matched_term:brake",
    "matched_term:inspection",
  ]);
  assert.match(twoTerms[0]?.reason ?? "", /title\/description terms \(brake, inspection\)/);
});

test("profile stopwords and input order produce deterministic candidate output", () => {
  const concepts = [
    { filePath: "concepts/z.md", pages: [20], sourceFile: "manual.pdf", tags: ["shared", "zulu"], terms: ["aircraft", "brake", "pressure"] },
    { filePath: "concepts/a.md", pages: [1], sourceFile: "manual.pdf", tags: ["shared", "alpha"], terms: ["aircraft", "brake", "pressure"] },
  ];
  const expected = buildDeterministicRelationCandidates(concepts, { stopwords: ["aircraft"] });
  const repeated = buildDeterministicRelationCandidates([...concepts].reverse(), { stopwords: ["aircraft"] });

  assert.deepEqual(repeated, expected);
  assert.equal(expected[0]?.sourceFile, "concepts/a.md");
  assert.equal(expected[0]?.targetFile, "concepts/z.md");
  assert.equal(expected[0]?.signals.includes("matched_term:aircraft"), false);
  assert.deepEqual(expected[0]?.signals.filter((signal) => signal.startsWith("matched_")), [
    "matched_term:brake",
    "matched_term:pressure",
    "matched_tag:shared",
  ]);
});
