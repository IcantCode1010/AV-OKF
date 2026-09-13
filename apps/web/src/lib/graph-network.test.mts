import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphNetwork, selectGraphNetwork } from "./graph-network.ts";
import type { EntityGraphSnapshot, EntityGraphNode, EntityGraphEdge } from "./entity-graph-view.ts";

const node = (id: string, kind: EntityGraphNode["kind"] = "entity", extra = {}): EntityGraphNode => ({ id, kind, title: id, type: kind === "entity" ? "system" : kind, status: "provisional", degree: 2, ...extra });
const edge = (id: string, source: string, target: string, extra = {}): EntityGraphEdge => ({ id, source, target, relation: "mentions", status: "structural", pages: [1], reason: id, ...extra });
function build(nodes: EntityGraphNode[], edges: EntityGraphEdge[]) {
  const entities: EntityGraphSnapshot = { nodes, edges, summary: { entities: 2, occurrences: 2, published: 0, attention: 1 } };
  return buildGraphNetwork({ entities, published: { nodes: [], edges: [] } });
}
test("full network shows every evidence-connected entity including other without creating semantic edges", () => {
  const input = build([node("topic", "topic"), node("one"), node("two", "entity", { type: "other" })], [edge("1", "topic", "one"), edge("2", "topic", "two")]);
  const view = selectGraphNetwork(input, "network");
  assert.equal(view.nodes.length, 3);
  assert.equal(view.edges.length, 2);
  assert.ok(view.edges.every((edge) => edge.status === "structural"));
  assert.ok(!view.edges.some((edge) => edge.source === "one" && edge.target === "two"));
});
test("parallel evidence folds into one line with all quotes and pages retained", () => {
  const result = build([node("one"), node("two")], [edge("1", "one", "two"), edge("2", "one", "two", { pages: [2], evidenceQuote: "Second quote" })]);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].count, 2);
  assert.deepEqual(result.edges[0].pages, [1, 2]);
  assert.equal(result.edges[0].evidence[1].evidenceQuote, "Second quote");
  assert.equal(result.nodes[0].degree, 1);
});
test("aliases are searchable node metadata and conflicting same-name entities stay separate", () => {
  const result = build([node("one", "entity", { title: "Pump" }), node("two", "entity", { title: "Pump", type: "product" }), node("alias", "alias", { title: "P1", status: "accepted" })], [edge("a", "alias", "one", { relation: "alias_of" })]);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[0].aliases, ["P1"]);
  assert.equal(result.edges.length, 0);
});
test("unverified and filtered assertions appear only in attention", () => {
  const result = build([node("one"), node("two")], [edge("x", "one", "two", { status: "filtered" })]);
  assert.equal(selectGraphNetwork(result, "network").edges.length, 0);
  assert.equal(selectGraphNetwork(result, "attention").edges.length, 1);
});
test("node type filtering removes dangling edges and recounts visible degree", () => {
  const result = build([node("one"), node("two", "entity", { type: "other" })], [edge("x", "one", "two")]);
  const filtered = selectGraphNetwork(result, "network", new Set(["other"]));
  assert.equal(filtered.edges.length, 0);
  assert.equal(filtered.nodes[0].degree, 0);
  assert.equal(result.nodes[0].degree, 1);
});
test("live OKF paths join entity-topic nodes and published relations without duplicate topics", () => {
  const result = buildGraphNetwork({
    entities: { nodes: [node("topic:a", "topic", { exportedFilePath: "a.md" })], edges: [], summary: { attention: 0, entities: 0, occurrences: 0, published: 0 } },
    published: { nodes: ["a.md", "b.md"].map((id) => ({ id, degree: 1, reviewStatus: "approved", sourceFile: null, sourcePages: [], title: id, type: "system_topic" })),
      edges: [{ id: "published:ab", source: "a.md", target: "b.md", relation: "references", reason: "Explicit reference" }] },
  });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges[0].source, "topic:a");
  assert.equal(selectGraphNetwork(result, "published").edges.length, 1);
});
test("stale published candidate records cannot recreate a missing live OKF edge", () => {
  const result = build([node("one"), node("two")], [edge("x", "one", "two", { status: "published" })]);
  assert.equal(result.edges.length, 0);
});
