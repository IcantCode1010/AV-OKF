import assert from "node:assert/strict";
import test from "node:test";
import { filterEntityGraphLayer } from "./entity-graph-layers.ts";
import type { EntityGraphEdge, EntityGraphNode } from "./entity-graph-view.ts";

test("published relationships, source evidence and candidates remain distinct without losing provenance", () => {
  const nodes: EntityGraphNode[] = ["a", "b", "c", "d"].map((id) => ({ id, title: id, degree: 1, kind: "topic", status: "grounded", type: "concept" }));
  const edges: EntityGraphEdge[] = ["published", "structural", "queued"].map((status, index) => ({ id: status, status, source: "a", target: nodes[index + 1].id, relation: "references", reason: "Source-supported relationship", pages: [12], evidenceQuote: "Quoted source evidence" }));
  const input = { nodes, edges };
  const published = filterEntityGraphLayer(input, "knowledge");
  assert.deepEqual(published.nodes.map((node) => node.id), ["a", "b"]);
  assert.deepEqual(published.edges, [edges[0]]);
  assert.deepEqual(filterEntityGraphLayer(input, "evidence").edges, [edges[1]]);
  assert.deepEqual(filterEntityGraphLayer(input, "review").edges, [edges[2]]);
  assert.equal(filterEntityGraphLayer(input, "all"), input);
  assert.deepEqual(published.edges[0].pages, [12]);
  assert.equal(published.edges[0].evidenceQuote, "Quoted source evidence");
});
