import assert from "node:assert/strict";
import test from "node:test";
import { projectResearchChatEvidence } from "./chat-research-projection.ts";
import type { ChatRetrievalResult } from "../chat-retrieval.ts";
import type { EvidenceRef, ResearchResult } from "./contracts.ts";

const citation = { index: 1, documentTitle: "Discovery only", text: "Uninspected snippet", sourceType: "okf" as const,
  pageStart: 1, pageEnd: 1, knowledgeBundleId: "bundle", okfFilePath: "topic.md" };
const base: ChatRetrievalResult = { citations: [citation], evidence: [citation], approvedOkfAvailable: true,
  ragUsedForDiscoveryOnly: false, okfEvidenceMode: "graph", okfMatchMode: "vector", retrievalError: false,
  retrievalToolsCalled: ["search"], sourcesRead: ["Discovery only"], rerank: { applied: false, dropped: 0, status: "not_applicable" },
  crossBundleConflict: { detected: true, bundleIds: ["bundle"], conflictingValues: ["old"] } };
const passage: EvidenceRef = { id: "page-1", documentId: "doc", documentTitle: "Inspected manual", collectionId: "bundle",
  page: 5, quote: "Checked source passage. ".repeat(30), sourceHash: "hash", revision: "revision", applicability: "all", authority: "manual", trust: "raw-source" };
const research = (evidence: EvidenceRef[], coverage: ResearchResult["coverage"] = "retrieved"): ResearchResult => ({ evidence, coverage, gaps: [], toolCalls: 2, modelSteps: 1 });

test("empty completed or budget-limited research cannot revive discovery snippets", () => {
  for (const coverage of ["retrieved", "partial"] as const) {
    const result = projectResearchChatEvidence(base, research([], coverage));
    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.evidence, []);
    assert.deepEqual(result.sourcesRead, []);
    assert.equal(result.approvedOkfAvailable, false);
    assert.equal(result.okfEvidenceMode, undefined);
    assert.equal(result.crossBundleConflict, undefined);
    assert.equal(result.retrievalError, false);
  }
});
test("only inspected passages reach synthesis, retaining full text and original pages", () => {
  const result = projectResearchChatEvidence(base, research([passage, passage]));
  assert.equal(result.citations.length, 1);
  assert.equal(result.evidence[0].text, passage.quote);
  assert.equal(result.citations[0].text.length, 240);
  assert.equal(result.citations[0].pageStart, 5);
  assert.deepEqual(result.sourcesRead, ["Inspected manual (p. 5)"]);
  assert.equal(result.approvedOkfAvailable, false);
  assert.equal(result.okfMatchMode, undefined);
  assert.equal(base.evidence[0].text, "Uninspected snippet");
});
