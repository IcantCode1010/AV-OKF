import assert from "node:assert/strict";
import test from "node:test";
import { publishedGraphResult } from "./published-graph-result.ts";

const topics = ["a", "b"].map((id) => ({ id, exportedFilePath: `${id}.md`, title: id,
  documentId: "manual", sourcePageNumbers: [id === "a" ? 1 : 2], privateField: "must not reach model" }));
const concepts = topics.map((topic) => ({ filePath: topic.exportedFilePath }));

test("incoming traversal preserves original assertion direction and source pointers", () => {
  const result = publishedGraphResult(topics, { concepts, warnings: [], paths: [{
    files: ["a.md", "b.md"], relationTypes: ["requires"], directions: ["incoming"],
  }] });
  assert.deepEqual(result.paths[0].connections, [{ sourceTopicId: "b", targetTopicId: "a", relation: "requires" }]);
  assert.deepEqual(result.nodes.map((node) => node.sourcePageNumbers), [[1], [2]]);
  assert.ok(result.nodes.every((node) => !("privateField" in node)));
});

test("isolated inspected concepts remain available to read_source", () => {
  const result = publishedGraphResult(topics, { concepts: [concepts[0]], paths: [], warnings: [] });
  assert.deepEqual(result.nodes.map((node) => node.id), ["a"]);
  assert.deepEqual(result.paths, []);
});

test("unknown or uninspected endpoints cannot become model-visible paths", () => {
  for (const file of ["b.md", "secret.md"]) {
    const result = publishedGraphResult(topics, { concepts: [concepts[0]], warnings: [], paths: [{
      files: ["a.md", file], relationTypes: ["references"],
    }] });
    assert.deepEqual(result.paths, []);
    assert.deepEqual(result.warnings, ["graph_path_unavailable"]);
    assert.ok(!JSON.stringify(result).includes("secret.md"));
  }
});

test("malformed paths are omitted and truncation remains explicit", () => {
  const result = publishedGraphResult(topics, { concepts, warnings: ["graph_time_budget_exhausted"], paths: [
    { files: ["a.md", "b.md"], relationTypes: [] },
    { files: ["a.md", "b.md"], relationTypes: ["requires"], directions: [] },
  ] }, true);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.warnings, ["graph_time_budget_exhausted", "graph_authorized_topic_budget_exhausted", "graph_path_unavailable"]);
});
