import assert from "node:assert/strict";
import test from "node:test";

import { createRagRepository } from "./rag-repository.ts";

test("createIndexJob increments document index version", async () => {
  const calls: string[] = [];
  const repository = createRagRepository({
    document: {
      findFirst: async () => ({ ragIndexVersion: 2 }),
      update: async () => {
        calls.push("document.update");
      },
    },
    ragIndexJob: {
      create: async ({ data }: { data: { indexVersion: number } }) => {
        calls.push(`job.version:${data.indexVersion}`);
        return {
          documentId: "doc_1",
          id: "job_1",
          indexVersion: data.indexVersion,
          workspaceId: "wrk_1",
        };
      },
    },
  });

  const job = await repository.createIndexJob({
    documentId: "doc_1",
    extractionJobId: "extract_1",
    workspaceId: "wrk_1",
  });

  assert.equal(job.indexVersion, 3);
  assert.deepEqual(calls, ["job.version:3", "document.update"]);
});

test("searchKeyword result objects include review status", async () => {
  const repository = createRagRepository({
    ragChunk: {
      findMany: async () => [createChunkRow({ reviewStatus: "raw_extracted" })],
    },
  });

  const [result] = await repository.searchKeyword({
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.equal(result?.reviewStatus, "raw_extracted");
});

test("searchVector result objects include review status", async () => {
  const repository = createRagRepository({
    $queryRaw: async () => [
      createVectorRow({ reviewStatus: "raw_extracted" }),
    ],
  });

  const [result] = await repository.searchVector({
    embedding: [0.1, 0.2],
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.equal(result?.reviewStatus, "raw_extracted");
});

test("searchKeyword filters document ids when provided", async () => {
  const capturedQueries: Array<{ where?: { documentId?: { in?: string[] } } }> =
    [];
  const rows = [
    createChunkRow({ documentId: "doc_a" }),
    createChunkRow({ documentId: "doc_b" }),
  ];
  const repository = createRagRepository({
    ragChunk: {
      findMany: async (query: {
        where?: { documentId?: { in?: string[] } };
      }) => {
        capturedQueries.push(query);
        const allowed = query.where?.documentId?.in;
        return allowed
          ? rows.filter((row) => allowed.includes(row.documentId))
          : rows;
      },
    },
  });

  const unfiltered = await repository.searchKeyword({
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });
  const filtered = await repository.searchKeyword({
    documentIds: ["doc_a"],
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.deepEqual(
    unfiltered.map((result) => result.documentId),
    ["doc_a", "doc_b"],
  );
  assert.deepEqual(
    filtered.map((result) => result.documentId),
    ["doc_a"],
  );
  assert.deepEqual(capturedQueries[1]?.where?.documentId?.in, ["doc_a"]);
});

test("searchVector filters document ids when provided", async () => {
  const capturedValues: unknown[][] = [];
  const repository = createRagRepository({
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedValues.push(values);
      const documentIds = values.find(
        (value): value is string[] =>
          Array.isArray(value) && value.every((item) => typeof item === "string"),
      );
      return [createVectorRow({ documentId: documentIds?.[0] ?? "doc_b" })];
    },
  });

  const filtered = await repository.searchVector({
    documentIds: ["doc_a"],
    embedding: [0.1, 0.2],
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.deepEqual(
    filtered.map((result) => result.documentId),
    ["doc_a"],
  );
  assert.equal(
    capturedValues.some((values) =>
      values.some(
        (value) =>
          Array.isArray(value) &&
          value.length === 1 &&
          value[0] === "doc_a",
      ),
    ),
    true,
  );
});

test("searchKeyword returns identical order for identical searches", async () => {
  let calls = 0;
  const rows = [
    createChunkRow({ chunkOrdinal: 2, documentId: "doc_b", id: "chunk_b_2" }),
    createChunkRow({ chunkOrdinal: 1, documentId: "doc_a", id: "chunk_a_1" }),
  ];
  const repository = createRagRepository({
    ragChunk: {
      findMany: async (query: {
        orderBy?: Array<Record<string, "asc">>;
      }) => {
        calls += 1;
        if (!query.orderBy) {
          return calls % 2 === 0 ? [...rows].reverse() : rows;
        }

        return [...rows].sort(
          (left, right) =>
            left.documentId.localeCompare(right.documentId) ||
            left.pageStart - right.pageStart ||
            left.chunkOrdinal - right.chunkOrdinal,
        );
      },
    },
  });

  const first = await repository.searchKeyword({
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });
  const second = await repository.searchKeyword({
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.deepEqual(
    first.map((result) => result.chunkId),
    second.map((result) => result.chunkId),
  );
});

function createChunkRow(overrides: Partial<ReturnType<typeof baseChunkRow>>) {
  return { ...baseChunkRow(), ...overrides };
}

function createVectorRow(overrides: Partial<ReturnType<typeof baseVectorRow>>) {
  return { ...baseVectorRow(), ...overrides };
}

function baseChunkRow() {
  return {
    chunkOrdinal: 1,
    document: { title: "Generator Manual" },
    documentId: "doc_1",
    id: "chunk_1",
    pageEnd: 1,
    pageStart: 1,
    reviewStatus: "raw_extracted",
    sourcePageNumbers: [1],
    text: "Generator control unit.",
  };
}

function baseVectorRow() {
  return {
    chunkId: "chunk_1",
    documentId: "doc_1",
    documentTitle: "Generator Manual",
    pageEnd: 1,
    pageStart: 1,
    reviewStatus: "raw_extracted",
    score: 0.8,
    sourcePageNumbers: [1],
    text: "Generator control unit.",
  };
}
