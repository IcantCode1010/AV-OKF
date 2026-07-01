import assert from "node:assert/strict";
import test from "node:test";

import { reciprocalRankFusion } from "./rag-retrieval.ts";

test("reciprocalRankFusion merges vector and keyword rankings deterministically", () => {
  const results = reciprocalRankFusion([
    [
      { chunkId: "a", score: 1 },
      { chunkId: "b", score: 0.5 },
    ],
    [
      { chunkId: "b", score: 1 },
      { chunkId: "c", score: 0.5 },
    ],
  ]);

  assert.deepEqual(
    results.map((result) => result.chunkId),
    ["b", "a", "c"],
  );
});
