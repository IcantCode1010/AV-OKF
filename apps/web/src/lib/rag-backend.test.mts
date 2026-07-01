import assert from "node:assert/strict";
import test from "node:test";

import { retrieveDocuments } from "./rag-backend.ts";

test("retrieveDocuments returns an empty local result set without production backend", async () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "local";

  try {
    const results = await retrieveDocuments({
      mode: "hybrid",
      query: "generator control",
      topK: 10,
      workspaceId: "wrk_1",
    });

    assert.deepEqual(results, []);
  } finally {
    process.env.AV_OKF_BACKEND = originalBackend;
  }
});
