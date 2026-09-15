import assert from "node:assert/strict";
import test from "node:test";
import { selectGraphEvidence, selectGraphEvidencePairs, pruneGraphEvidenceContext, type GraphEvidenceContext } from "./okf-graph-evidence.ts";
import type { OkfBundleEvidence } from "./okf-bundle-retriever.ts";
import { runChatRetrieval, mergeAdaptiveRetrievalResults, type ChatRetrievalResult } from "./chat-retrieval.ts";
import type { ChatRouterDecision } from "./chat-router.ts";
import { buildChatAnswerPrompt } from "./chat-answer.ts";

function node(filePath: string, title = filePath): OkfBundleEvidence {
  return {
    filePath, title, approvalProvenance: "human", answerableMetadata: {}, body: title,
    coveredRagChunkIds: [], coverageType: null, description: title, excerpt: title,
    matchedTerms: [], matchReason: "test", matchStrength: "strong", lifecycleStatus: "active",
    lifecycleWarnings: [], pageEnd: 1, pageStart: 1, relations: [], reviewStatus: "approved",
    score: 1, sourceFile: "manual.pdf", sourcePages: [1], sourceType: "okf_bundle", type: "system_topic",
  };
}

test("four direct hits do not starve graph evidence, and a selected path stays complete", () => {
  const direct = [node("a"), node("b"), node("c"), node("d")];
  const result = selectGraphEvidence({ direct, query: "actuator supply", graph: {
    concepts: [node("e", "Supply"), node("f", "Actuator")],
    paths: [{ files: ["a", "e"], relationTypes: ["references"] }, { files: ["a", "e", "f"], relationTypes: ["references", "feeds"] }], warnings: [],
  } });
  assert.ok(result.concepts.some((entry) => entry.filePath === "f"));
  for (const path of result.paths) assert.ok(path.files.every((file) => result.concepts.some((entry) => entry.filePath === file)));
  assert.equal(result.concepts.length, 6);
});

test("relevant connected concepts win over alphabetical order within the budget", () => {
  const result = selectGraphEvidence({ direct: [node("seed")], limit: 3, query: "actuator", graph: {
    concepts: [node("aaa", "Unrelated"), node("zzz", "Actuator")],
    paths: [{ files: ["seed", "zzz"], relationTypes: ["references"] }], warnings: [],
  } });
  assert.equal(result.concepts[1].filePath, "zzz");
  assert.ok(result.concepts.length <= 3);
});

test("paths with unavailable endpoints are excluded from model context", () => {
  const result = selectGraphEvidence({ direct: [node("seed")], query: "seed", graph: {
    concepts: [], paths: [{ files: ["seed", "missing"], relationTypes: ["references"] }], warnings: [],
  } });
  assert.deepEqual(result.paths, []);
});

test("graph evidence survives the chat pipeline and reaches the answer prompt", async () => {
  const query = "How does supply affect the actuator?";
  const result = await runChatRetrieval({
    query, workspaceId: "wrk_test", knowledgeBundleId: "kb_test",
    decision: { route: "okf_only", requiresGraphTraversal: true, confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false }, queryCategory: "canonical_definition", rationale: "test", requiredContext: [] },
  }, async () => { throw Error("Unexpected raw retrieval"); },
  async () => [node("seed", "Supply"), node("b"), node("c"), node("d")],
  async () => ({ concepts: [node("actuator", "Actuator")], paths: [{ files: ["seed", "actuator"], relationTypes: ["feeds"] }], warnings: [] }));
  assert.ok(result.evidence.some((entry) => entry.okfFilePath === "actuator"));
  const prompt = buildChatAnswerPrompt({ query, evidence: result.evidence, route: "okf_only" });
  assert.match(prompt, /"source":"Supply","relation":"feeds","target":"Actuator"/);
  assert.match(prompt, /do not assume transitivity/);
  assert.equal(result.okfEvidenceMode, "graph");
});

test("final ranking reserves all path members even when the connected result ranks last", () => {
  const pairs = Array.from({ length: 10 }, (_, index) => ({ evidence: {
    okfFilePath: `${index}.md`, knowledgeBundleId: "bundle-a",
    ...(index === 9 ? { graphPaths: [{ files: ["0.md", "8.md", "9.md"], relationTypes: ["references", "feeds"] }] } : {}),
  } }));
  const selected = selectGraphEvidencePairs(pairs, 4);
  assert.deepEqual(selected.map((pair) => pair.evidence.okfFilePath), ["0.md", "1.md", "8.md", "9.md"]);
});

test("equal file names in another bundle cannot complete a graph path", () => {
  const pairs = [
    { evidence: { okfFilePath: "seed.md", knowledgeBundleId: "other" } },
    { evidence: { okfFilePath: "direct.md", knowledgeBundleId: "bundle" } },
    { evidence: { okfFilePath: "target.md", knowledgeBundleId: "bundle", graphPaths: [{ files: ["seed.md", "target.md"], relationTypes: ["feeds"] }] } },
  ];
  const selected = selectGraphEvidencePairs(pairs, 2);
  assert.deepEqual(selected, pairs.slice(0, 2));
});

test("discarded paths cannot leak missing endpoint names into model context", () => {
  const evidence: GraphEvidenceContext[] = [{
    okfFilePath: "target.md", knowledgeBundleId: "bundle",
    graphPaths: [{ files: ["seed.md", "target.md"], relationTypes: ["feeds"] }],
    graphConnections: [{ source: "Seed", target: "Target", relation: "feeds", sourceFile: "seed.md", targetFile: "target.md" }],
  }, { okfFilePath: "seed.md", knowledgeBundleId: "other" }];
  const pruned = pruneGraphEvidenceContext(evidence);
  assert.deepEqual(pruned[0].graphPaths, []);
  assert.deepEqual(pruned[0].graphConnections, []);
  assert.equal(evidence[0].graphConnections?.length, 1, "source input remains immutable");
  const complete = pruneGraphEvidenceContext([evidence[0], { okfFilePath: "seed.md", knowledgeBundleId: "bundle" }]);
  assert.equal(complete[0].graphConnections?.length, 1);
});

test("incoming exploration retains the original assertion direction after pruning", () => {
  const context: GraphEvidenceContext = {
    okfFilePath: "actuator.md", knowledgeBundleId: "bundle",
    graphPaths: [{ files: ["actuator.md", "supply.md"], relationTypes: ["feeds"], directions: ["incoming"] }],
    graphConnections: [{ source: "Supply", target: "Actuator", sourceFile: "supply.md", targetFile: "actuator.md", relation: "feeds" }],
  };
  const result = pruneGraphEvidenceContext([context, { okfFilePath: "supply.md", knowledgeBundleId: "bundle" }]);
  assert.deepEqual(result[0].graphConnections, context.graphConnections);
});

const graphDecision: ChatRouterDecision = { route: "okf_only", requiresGraphTraversal: true, confidence: "high", constraints: { approvedOnly: true, includeUnreviewed: false }, queryCategory: "canonical_definition", rationale: "test", requiredContext: [] };
function retrievalFixture(files: string[], connected: boolean): ChatRetrievalResult {
  const evidence = files.map((file, index) => ({ index: index + 1, documentTitle: file, text: `${file} evidence`, sourceType: "okf" as const,
    okfFilePath: file, knowledgeBundleId: "bundle", pageStart: 1, pageEnd: 1, graphDerived: connected && file === "target",
    ...(connected ? { graphPaths: [{ files: ["seed", "target"], relationTypes: ["feeds"] }], graphConnections: [{ source: "Seed", target: "Target", sourceFile: "seed", targetFile: "target", relation: "feeds" }] } : {}),
  }));
  return { evidence, citations: evidence.map((item) => ({ ...item })), approvedOkfAvailable: true, ragUsedForDiscoveryOnly: false,
    retrievalError: false, retrievalToolsCalled: [], sourcesRead: [], okfEvidenceMode: connected ? "graph" : "direct", rerank: { applied: false, dropped: 0, status: "not_applicable" } };
}

test("adaptive retry retains new graph context on already retrieved concepts", () => {
  const original = retrievalFixture(["seed", "target"], false);
  const retry = retrievalFixture(["seed", "target"], true);
  const merged = mergeAdaptiveRetrievalResults(original, retry, graphDecision);
  assert.equal(merged.result.evidence.length, 2);
  assert.equal(merged.result.evidence.find((item) => item.okfFilePath === "target")?.graphConnections?.length, 1);
  assert.equal(merged.result.okfEvidenceMode, "graph");
  assert.equal(merged.evidenceDelta.citations, 0);
});

test("changed retry evidence invalidates old connection context that was not re-inspected", () => {
  const original = retrievalFixture(["seed", "target"], true);
  const retry = retrievalFixture(["target"], false);
  retry.evidence[0].text = "Revised target evidence";
  const merged = mergeAdaptiveRetrievalResults(original, retry, graphDecision).result;
  assert.equal(merged.evidence.find((item) => item.okfFilePath === "target")?.text, "Revised target evidence");
  assert.deepEqual(merged.evidence.find((item) => item.okfFilePath === "seed")?.graphConnections, []);
  assert.equal(original.evidence[0].graphConnections?.length, 1);
});
