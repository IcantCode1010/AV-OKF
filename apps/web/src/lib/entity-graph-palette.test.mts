import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTITY_GRAPH_TYPE_COLORS,
  entityGraphColorCss,
  getEntityGraphTypeColor,
} from "./entity-graph-palette.ts";

test("generic entity types have distinct stable graph colors", () => {
  const colors = Object.values(ENTITY_GRAPH_TYPE_COLORS).map((color) => color.join(","));
  assert.equal(colors.length, 8);
  assert.equal(new Set(colors).size, colors.length);
  assert.notDeepEqual(getEntityGraphTypeColor("person"), getEntityGraphTypeColor("system"));
});

test("structural graph nodes remain neutral and unknown entities use other", () => {
  assert.notDeepEqual(getEntityGraphTypeColor("concept"), getEntityGraphTypeColor("system"));
  assert.deepEqual(getEntityGraphTypeColor("unknown-producer-type"), ENTITY_GRAPH_TYPE_COLORS.other);
  assert.match(entityGraphColorCss("regulation"), /^rgb\(\d+ \d+ \d+\)$/);
});
