import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveOkfCoverage,
  syncOkfConceptCoverage,
  type OkfCoverageRepository,
} from "./okf-coverage.ts";

function createFakeRepository(
  chunks: { id: string; sourcePageNumbers: number[] }[] = [],
) {
  const syncCalls: Parameters<OkfCoverageRepository["syncOkfConceptChunkLinks"]>[0][] =
    [];
  const repository: OkfCoverageRepository = {
    async listActiveChunksForDocument() {
      return chunks;
    },
    async syncOkfConceptChunkLinks(input) {
      syncCalls.push(input);
    },
  };

  return { repository, syncCalls };
}

test("resolveOkfCoverage returns chunks whose page range overlaps the topic's pages", async () => {
  const { repository } = createFakeRepository([
    { id: "chunk_1", sourcePageNumbers: [40] },
    { id: "chunk_2", sourcePageNumbers: [41, 42] },
    { id: "chunk_3", sourcePageNumbers: [50] },
  ]);

  const resolution = await resolveOkfCoverage({
    documentId: "doc_1",
    repository,
    sourcePageNumbers: [41, 42, 43],
    workspaceId: "wrk_1",
  });

  assert.deepEqual(resolution.chunkIds, ["chunk_2"]);
  assert.equal(resolution.coverageType, "direct_source");
});

test("resolveOkfCoverage returns no chunks when nothing overlaps", async () => {
  const { repository } = createFakeRepository([
    { id: "chunk_1", sourcePageNumbers: [1, 2] },
  ]);

  const resolution = await resolveOkfCoverage({
    documentId: "doc_1",
    repository,
    sourcePageNumbers: [41, 42, 43],
    workspaceId: "wrk_1",
  });

  assert.deepEqual(resolution.chunkIds, []);
});

test("resolveOkfCoverage returns deterministically sorted chunk ids", async () => {
  const { repository } = createFakeRepository([
    { id: "chunk_b", sourcePageNumbers: [41] },
    { id: "chunk_a", sourcePageNumbers: [42] },
  ]);

  const resolution = await resolveOkfCoverage({
    documentId: "doc_1",
    repository,
    sourcePageNumbers: [41, 42],
    workspaceId: "wrk_1",
  });

  assert.deepEqual(resolution.chunkIds, ["chunk_a", "chunk_b"]);
});

test("syncOkfConceptCoverage forwards the resolved chunk ids and coverage type", async () => {
  const { repository, syncCalls } = createFakeRepository();

  await syncOkfConceptCoverage({
    chunkIds: ["chunk_1", "chunk_2"],
    coverageType: "direct_source",
    okfConceptId: "topic_1",
    repository,
    workspaceId: "wrk_1",
  });

  assert.deepEqual(syncCalls, [
    {
      chunkIds: ["chunk_1", "chunk_2"],
      coverageType: "direct_source",
      okfConceptId: "topic_1",
      workspaceId: "wrk_1",
    },
  ]);
});
