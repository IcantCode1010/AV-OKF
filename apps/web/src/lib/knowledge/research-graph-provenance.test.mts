import assert from "node:assert/strict";
import test from "node:test";
import { researchGraphProvenance } from "./research-graph-provenance.ts";
import { buildChatAnswerConnections } from "../chat-answer-graph.ts";
import { finalizeChatTurn } from "../chat-turn-finalization.ts";
import type { EvidenceRef } from "./contracts.ts";

const evidence: EvidenceRef[] = ["a", "b"].map((id, index) => ({ id, documentId: "manual", documentTitle: "Manual",
  collectionId: "bundle", page: index + 1, quote: id, sourceHash: id, revision: "1", applicability: "all", authority: "manual", trust: "raw-source" }));
const discovery = { nodes: evidence.map((entry) => ({ id: entry.id, title: `Topic ${entry.id}`, documentId: entry.documentId, sourcePageNumbers: [entry.page] })),
  paths: [{ connections: [{ sourceTopicId: "b", targetTopicId: "a", relation: "requires" }] }] };

test("published discovery maps through inspected passages to final citation numbers", () => {
  const provenance = researchGraphProvenance([discovery, discovery], evidence);
  assert.equal(provenance.length, 1);
  const citations = evidence.map((entry, index) => ({ researchEvidenceId: entry.id, index: index + 7,
    sourceType: "rag" as const, documentTitle: entry.documentTitle, pageStart: entry.page, pageEnd: entry.page, text: entry.quote }));
  assert.deepEqual(buildChatAnswerConnections([], citations, provenance), [{ sourceCitation: 8, targetCitation: 7,
    relation: "requires", sourceTitle: "Topic b", targetTitle: "Topic a", sourceTopicId: "b", targetTopicId: "a" }]);
  assert.deepEqual(buildChatAnswerConnections([], citations.slice(0, 1), provenance), []);
  const overlapping = provenance.map((edge) => ({ ...edge, sourceEvidenceIds: ["a"], targetEvidenceIds: ["a", "b"] }));
  assert.equal(buildChatAnswerConnections([], citations, overlapping).length, 1);
  const sharedPage = provenance.map((edge) => ({ ...edge, sourceEvidenceIds: ["a"], targetEvidenceIds: ["a"] }));
  const sameCitation = buildChatAnswerConnections([], citations.slice(0, 1), sharedPage);
  assert.equal(sameCitation.length, 1);
  assert.equal(sameCitation[0].sourceCitation, sameCitation[0].targetCitation);
  assert.notEqual(sameCitation[0].sourceTopicId, sameCitation[0].targetTopicId);
  const finalized = finalizeChatTurn({ citations, content: "First source [8], followed by the supporting source [7].", outcome: "answered" });
  assert.deepEqual(finalized.citations.map((citation) => citation.researchEvidenceId), ["b", "a"]);
  assert.deepEqual(buildChatAnswerConnections([], finalized.citations, provenance), [{ sourceCitation: 1, targetCitation: 2,
    relation: "requires", sourceTitle: "Topic b", targetTitle: "Topic a", sourceTopicId: "b", targetTopicId: "a" }]);
  const insufficient = finalizeChatTurn({ citations, content: "Insufficient evidence.", outcome: "insufficient_evidence" });
  assert.deepEqual(buildChatAnswerConnections([], insufficient.citations, provenance), []);
});
test("unread pages and different documents cannot supply an endpoint", () => {
  assert.deepEqual(researchGraphProvenance([discovery], evidence.slice(0, 1)), []);
  assert.deepEqual(researchGraphProvenance([discovery], evidence.map((entry) => ({ ...entry, documentId: "other" }))), []);
  assert.deepEqual(researchGraphProvenance([discovery], evidence.map((entry) => ({ ...entry, page: 99 }))), []);
});
