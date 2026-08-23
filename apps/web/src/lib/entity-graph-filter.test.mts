import assert from "node:assert/strict";
import test from "node:test";

import { filterEntityGraphByEntityIds } from "./entity-graph-filter.ts";

const nodes = [
  { degree: 3, id: "entity:a", kind: "entity" as const, status: "reviewed", title: "Alpha", type: "system" },
  { degree: 1, id: "entity:b", kind: "entity" as const, status: "reviewed", title: "Bravo", type: "standard" },
  { degree: 2, id: "topic:a", kind: "topic" as const, status: "approved", title: "Alpha topic", type: "concept" },
  { degree: 1, id: "document:a", kind: "document" as const, status: "source", title: "Alpha manual", type: "document" },
  { degree: 1, id: "topic:b", kind: "topic" as const, status: "approved", title: "Bravo topic", type: "concept" },
];
const edges = [
  { id: "mention:a", pages: [1], reason: "Alpha", relation: "mentions", source: "topic:a", status: "structural", target: "entity:a" },
  { id: "occurs:a", pages: [1], reason: "Alpha", relation: "occurs_in", source: "entity:a", status: "structural", target: "document:a" },
  { id: "mention:b", pages: [2], reason: "Bravo", relation: "mentions", source: "topic:b", status: "structural", target: "entity:b" },
];

test("entity graph filtering keeps selected entities and their direct neighborhood", () => {
  const result = filterEntityGraphByEntityIds({ edges, nodes, selectedEntityIds: ["entity:a"] });

  assert.deepEqual(result.nodes.map((node) => node.id), ["entity:a", "topic:a", "document:a"]);
  assert.deepEqual(result.edges.map((edge) => edge.id), ["mention:a", "occurs:a"]);
  assert.equal(result.nodes.find((node) => node.id === "entity:a")?.degree, 2);
  assert.equal(result.nodes.some((node) => node.id === "entity:b"), false);
});

test("entity graph filtering returns an empty canvas when no entities are selected", () => {
  assert.deepEqual(
    filterEntityGraphByEntityIds({ edges, nodes, selectedEntityIds: [] }),
    { edges: [], nodes: [] },
  );
});

test("entity graph filtering ignores unknown entity identifiers", () => {
  assert.deepEqual(
    filterEntityGraphByEntityIds({ edges, nodes, selectedEntityIds: ["entity:unknown"] }),
    { edges: [], nodes: [] },
  );
});
