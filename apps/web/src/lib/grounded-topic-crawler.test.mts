import assert from "node:assert/strict";
import test from "node:test";

import { buildTfidfSeeds } from "./grounded-topic-crawler.ts";

test("crawler TF-IDF seeds are deterministic and exclude represented topic terms", () => {
  const chunks = [
    "hydraulic accumulator pressure monitoring procedure",
    "hydraulic accumulator servicing limits",
    "electrical standby bus isolation",
  ];
  const first = buildTfidfSeeds(chunks, ["Hydraulic accumulator"]);
  const second = buildTfidfSeeds(chunks, ["Hydraulic accumulator"]);
  assert.deepEqual(first, second);
  assert.equal(first.includes("hydraulic"), false);
  assert.ok(first.includes("pressure") || first.includes("servicing"));
});
