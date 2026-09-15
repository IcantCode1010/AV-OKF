import assert from "node:assert/strict";
import test from "node:test";
import { validateResearchGraph } from "./validate-research-graph.ts";
import type { EvidenceRef } from "./contracts.ts";

const evidence: EvidenceRef[] = ["a", "b"].map((id, index) => ({ id, documentId: "doc", documentTitle: "Manual", collectionId: "bundle", page: index + 1,
  quote: id, sourceHash: id, revision: "1", applicability: "all", authority: "manual", trust: "raw-source" }));
const topics = evidence.map((entry) => ({ id: entry.id, title: entry.id, documentId: entry.documentId, sourcePageNumbers: [entry.page], exportedFilePath: `${entry.id}.md`, knowledgeBundleId: "bundle" }));
const connections = [{ sourceTopicId: "a", targetTopicId: "b", sourceTitle: "a", targetTitle: "b", relation: "requires", sourceEvidenceIds: ["a"], targetEvidenceIds: ["b"] }];
test("validates current publication with original direction", async () => {
  await validateResearchGraph({ topics, evidence, connections, hasPublishedConnection: async (source, target, relation) => {
    assert.equal(source.id, "a"); assert.equal(target.id, "b"); assert.equal(relation, "requires"); return true;
  } });
});
test("removed publication or changed endpoint mapping invalidates provenance", async () => {
  await assert.rejects(validateResearchGraph({ topics, evidence, connections, hasPublishedConnection: async () => false }), /knowledge_graph_changed/);
  for (const changed of [topics.slice(0, 1), topics.map((topic) => ({ ...topic, sourcePageNumbers: [99] })), topics.map((topic) => ({ ...topic, title: "revised" }))]) {
    await assert.rejects(validateResearchGraph({ topics: changed, evidence, connections, hasPublishedConnection: async () => true }), /knowledge_graph_changed/);
  }
});
