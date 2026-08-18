import assert from "node:assert/strict";
import test from "node:test";

import { packEmbeddingBatches } from "./rag-batch-indexer.ts";
import type { RagChunkRecord } from "./rag-types.ts";

test("embedding batches enforce both chunk and token ceilings", () => {
  const chunks = Array.from({ length: 70 }, (_, index) => ({
    chunkOrdinal: index, contentHash: `${index}`, documentId: "doc", headingPath: [], id: `${index}`,
    indexJobId: "job", indexVersion: 1, pageEnd: index + 1, pageStart: index + 1,
    reviewStatus: "raw_extracted", sourcePageNumbers: [index + 1], text: "source", tokenCount: 1_000, workspaceId: "wrk",
  } satisfies RagChunkRecord));
  const batches = packEmbeddingBatches(chunks);
  assert.ok(batches.every((batch) => batch.length <= 64));
  assert.ok(batches.every((batch) => batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0) <= 50_000));
  assert.deepEqual(batches.flat().map((chunk) => chunk.id), chunks.map((chunk) => chunk.id));
});
