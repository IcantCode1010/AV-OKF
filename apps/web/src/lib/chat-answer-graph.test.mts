import assert from "node:assert/strict";
import test from "node:test";
import { buildChatAnswerConnections } from "./chat-answer-graph.ts";
import type { ChatCitation } from "./chat-types.ts";

const citations: ChatCitation[] = ["a", "b"].map((file, index) => ({ index: index + 4, documentTitle: file,
  knowledgeBundleId: "bundle", okfFilePath: `${file}.md`, sourceType: "okf", text: file, pageStart: 1, pageEnd: 1 }));
const evidence = [{ knowledgeBundleId: "bundle", graphConnections: [{ source: "a", target: "b", sourceFile: "a.md", targetFile: "b.md", relation: "requires" }] }];

test("uses final citation numbering and deduplicates repeated paths", () => {
  assert.deepEqual(buildChatAnswerConnections([...evidence, ...evidence], citations), [{ sourceCitation: 4, targetCitation: 5, relation: "requires" }]);
});
test("never retains an uncited, withdrawn, or cross-bundle endpoint", () => {
  assert.deepEqual(buildChatAnswerConnections(evidence, citations.slice(0, 1)), []);
  assert.deepEqual(buildChatAnswerConnections(evidence, citations.map((citation) => ({ ...citation, knowledgeBundleId: "other" }))), []);
  assert.deepEqual(buildChatAnswerConnections(evidence, [citations[0], { ...citations[1], lifecycleNotice: "withdrawn" }]), []);
});
test("no graph context does not manufacture a connection", () => {
  assert.deepEqual(buildChatAnswerConnections([], citations), []);
});
