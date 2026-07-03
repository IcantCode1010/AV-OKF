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

test("createReindexJob rejects when another workspace document is in flight", async () => {
  const calls: string[] = [];
  let documentLookup = 0;
  const repository = createRagRepository({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRaw: async () => {
          calls.push("lock");
        },
        document: {
          findFirst: async () => {
            documentLookup += 1;
            return documentLookup === 1
              ? { ragIndexVersion: 1 }
              : { id: "doc_active" };
          },
        },
        ragIndexJob: {
          create: async () => {
            calls.push("job.create");
          },
        },
      }),
  });

  await assert.rejects(
    () =>
      repository.createReindexJob({
        chunkingStrategyId: "paragraph-v1",
        documentId: "doc_b",
        workspaceId: "wrk_1",
      }),
    /reindex_already_running:doc_active/,
  );

  assert.deepEqual(calls, ["lock"]);
});

test("deleteChunksForDocument deletes only raw extraction embeddings and chunks inside one transaction", async () => {
  const calls: string[] = [];
  const repository = createRagRepository({
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      calls.push("transaction.start");
      await callback({
        ragChunk: {
          deleteMany: async (query: {
            where: {
              documentId: string;
              sourceType: string;
              workspaceId: string;
            };
          }) => {
            calls.push(
              `chunks:${query.where.workspaceId}:${query.where.documentId}:${query.where.sourceType}`,
            );
          },
        },
        ragEmbedding: {
          deleteMany: async (query: {
            where: {
              chunk: {
                documentId: string;
                sourceType: string;
                workspaceId: string;
              };
            };
          }) => {
            calls.push(
              `embeddings:${query.where.chunk.workspaceId}:${query.where.chunk.documentId}:${query.where.chunk.sourceType}`,
            );
          },
        },
      });
      calls.push("transaction.end");
    },
  });

  await repository.deleteChunksForDocument({
    documentId: "doc_1",
    workspaceId: "wrk_1",
  });

  assert.deepEqual(calls, [
    "transaction.start",
    "embeddings:wrk_1:doc_1:raw_extraction",
    "chunks:wrk_1:doc_1:raw_extraction",
    "transaction.end",
  ]);
});

test("deleteOkfSyncedChunks deletes only OKF topic chunks for the requested scope", async () => {
  const calls: string[] = [];
  const repository = createRagRepository({
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      calls.push("transaction.start");
      await callback({
        ragChunk: {
          deleteMany: async (query: {
            where: {
              documentId: string;
              sourceTopicId?: string;
              sourceType: string;
              workspaceId: string;
            };
          }) => {
            calls.push(
              `chunks:${query.where.workspaceId}:${query.where.documentId}:${query.where.sourceType}:${query.where.sourceTopicId}`,
            );
          },
        },
        ragEmbedding: {
          deleteMany: async (query: {
            where: {
              chunk: {
                documentId: string;
                sourceTopicId?: string;
                sourceType: string;
                workspaceId: string;
              };
            };
          }) => {
            calls.push(
              `embeddings:${query.where.chunk.workspaceId}:${query.where.chunk.documentId}:${query.where.chunk.sourceType}:${query.where.chunk.sourceTopicId}`,
            );
          },
        },
      });
      calls.push("transaction.end");
    },
  });

  await repository.deleteOkfSyncedChunks({
    documentId: "doc_1",
    sourceTopicId: "topic_1",
    workspaceId: "wrk_1",
  });

  assert.deepEqual(calls, [
    "transaction.start",
    "embeddings:wrk_1:doc_1:okf_topic:topic_1",
    "chunks:wrk_1:doc_1:okf_topic:topic_1",
    "transaction.end",
  ]);
});

test("createOkfSyncIndexJob advances document index version for per-topic chunks", async () => {
  const calls: string[] = [];
  const repository = createRagRepository({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRaw: async () => {
          calls.push("lock");
        },
        document: {
          findFirst: async () => ({ ragIndexVersion: 7 }),
          update: async (query: { data: { ragIndexVersion: number } }) => {
            calls.push(`document.version:${query.data.ragIndexVersion}`);
          },
        },
        ragIndexJob: {
          aggregate: async () => ({ _sum: { tokenEstimate: 0 } }),
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
      }),
  });

  await repository.createOkfSyncIndexJob({
    documentId: "doc_1",
    tokenEstimate: 10,
    workspaceId: "wrk_1",
  });

  assert.deepEqual(calls, [
    "lock",
    "lock",
    "document.version:8",
    "job.version:8",
  ]);
});


test("searchKeyword result objects include review status", async () => {
  const repository = createRagRepository({
    ragChunk: {
      findMany: async () => [
        createChunkRow({
          reviewStatus: "approved",
          sourceType: "okf_topic",
        }),
      ],
    },
  });

  const [result] = await repository.searchKeyword({
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.equal(result?.reviewStatus, "approved");
  assert.equal(result?.sourceType, "okf_topic");
});

test("searchVector result objects include review status and source type", async () => {
  const repository = createRagRepository({
    $queryRaw: async () => [
      createVectorRow({ reviewStatus: "approved", sourceType: "okf_topic" }),
    ],
  });

  const [result] = await repository.searchVector({
    embedding: [0.1, 0.2],
    query: "generator",
    topK: 10,
    workspaceId: "wrk_1",
  });

  assert.equal(result?.reviewStatus, "approved");
  assert.equal(result?.sourceType, "okf_topic");
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

test("storeCompletedIndex deactivates only raw extraction chunks before writing raw index chunks", async () => {
  const calls: string[] = [];
  const repository = createRagRepository({
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        $executeRaw: async () => {
          calls.push("embedding.insert");
        },
        document: {
          update: async () => {
            calls.push("document.update");
          },
        },
        ragChunk: {
          create: async (query: {
            data: { sourceType?: string; sourceTopicId?: string | null };
          }) => {
            calls.push(
              `chunk.create:${query.data.sourceType}:${query.data.sourceTopicId}`,
            );
          },
          updateMany: async (query: {
            where: { documentId: string; sourceType: string; workspaceId: string };
          }) => {
            calls.push(
              `chunk.deactivate:${query.where.workspaceId}:${query.where.documentId}:${query.where.sourceType}`,
            );
          },
        },
        ragIndexJob: {
          update: async () => {
            calls.push("job.update");
          },
        },
      }),
  });

  await repository.storeCompletedIndex({
    chunks: [
      {
        chunkOrdinal: 0,
        contentHash: "hash",
        documentId: "doc_1",
        headingPath: [],
        id: "chunk_1",
        indexJobId: "job_1",
        indexVersion: 1,
        pageEnd: 1,
        pageStart: 1,
        reviewStatus: "raw_extracted",
        sourcePageNumbers: [1],
        text: "raw text",
        tokenCount: 2,
        workspaceId: "wrk_1",
      },
    ],
    documentId: "doc_1",
    embeddings: [[0.1, 0.2]],
    indexJobId: "job_1",
    indexVersion: 1,
    model: "test",
    workspaceId: "wrk_1",
  });

  assert.deepEqual(calls, [
    "chunk.deactivate:wrk_1:doc_1:raw_extraction",
    "chunk.create:raw_extraction:null",
    "embedding.insert",
    "job.update",
    "document.update",
  ]);
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
    sourceType: "raw_extraction",
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
    sourceType: "raw_extraction",
    sourcePageNumbers: [1],
    text: "Generator control unit.",
  };
}
