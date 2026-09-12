import assert from "node:assert/strict";
import test from "node:test";

import { buildTopicEnrichmentContextPageNumbers } from "./topic-enrichment-context.ts";

test("non-contiguous evidence anchors do not expand into the intervening document", () => {
  assert.deepEqual(buildTopicEnrichmentContextPageNumbers({
    pageEnd: 582,
    pageStart: 10,
    sourcePageNumbers: [582, 10],
  }), [8, 9, 10, 11, 12, 580, 581, 582, 583, 584]);
});

test("contiguous evidence neighborhoods are unique and ordered", () => {
  assert.deepEqual(buildTopicEnrichmentContextPageNumbers({
    pageEnd: 13,
    pageStart: 12,
    sourcePageNumbers: [12, 13],
  }), [10, 11, 12, 13, 14, 15]);
});
