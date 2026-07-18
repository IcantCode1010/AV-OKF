import assert from "node:assert/strict";
import test from "node:test";

import { runProductionExtractionJob } from "./production-worker.ts";

test("runProductionExtractionJob writes extracted pages and marks job complete", async () => {
  const calls: string[] = [];
  const repository = {
    completeExtractionJob: async (input: {
      documentId: string;
      extractionJobId: string;
      pageRecords: Array<{ pageNumber: number; text: string }>;
      workspaceId: string;
    }) => {
      calls.push(`complete:${input.workspaceId}:${input.documentId}:${input.extractionJobId}:${input.pageRecords.length}`);
    },
    failExtractionJob: async () => {
      calls.push("fail");
    },
    getPrimaryDocumentObject: async () => ({
      objectKey: "workspaces/wrk_1/documents/doc_1/original/obj_1.pdf",
    }),
    startExtractionJob: async () => {
      calls.push("start");
    },
  };
  const storage = {
    getObject: async () => Buffer.from("%PDF-1.7\n"),
  };

  await runProductionExtractionJob(
    { documentId: "doc_1", extractionJobId: "job_1", workspaceId: "wrk_1" },
    {
      extractPdfPages: async () => [
        {
          charCount: 11,
          imageCount: 0,
          pageNumber: 1,
          tables: [],
          text: "Page text",
        },
      ],
      repository,
      storage,
    },
  );

  assert.deepEqual(calls, ["start", "complete:wrk_1:doc_1:job_1:1"]);
});

test("runProductionExtractionJob queues RAG indexing after extraction completes", async () => {
  const calls: string[] = [];
  const repository = {
    completeExtractionJob: async () => {
      calls.push("complete");
    },
    createRagIndexJobAfterExtraction: async (input: {
      documentId: string;
      extractionJobId: string;
      workspaceId: string;
    }) => {
      calls.push(
        `create-rag:${input.workspaceId}:${input.documentId}:${input.extractionJobId}`,
      );
      return {
        documentId: input.documentId,
        id: "rag_job_1",
        indexVersion: 2,
        workspaceId: input.workspaceId,
      };
    },
    failExtractionJob: async () => {
      calls.push("fail");
    },
    getPrimaryDocumentObject: async () => ({
      objectKey: "workspaces/wrk_1/documents/doc_1/original/obj_1.pdf",
    }),
    startExtractionJob: async () => {
      calls.push("start");
    },
  };
  const ragQueue = {
    enqueueIndexJob: async (input: {
      documentId: string;
      indexJobId: string;
      indexVersion: number;
      workspaceId: string;
    }) => {
      calls.push(
        `enqueue-rag:${input.workspaceId}:${input.documentId}:${input.indexJobId}:${input.indexVersion}`,
      );
    },
  };
  const storage = {
    getObject: async () => Buffer.from("%PDF-1.7\n"),
  };

  await runProductionExtractionJob(
    { documentId: "doc_1", extractionJobId: "job_1", workspaceId: "wrk_1" },
    {
      extractPdfPages: async () => [
        {
          charCount: 11,
          imageCount: 0,
          pageNumber: 1,
          tables: [],
          text: "Page text",
        },
      ],
      ragQueue,
      repository,
      storage,
    },
  );

  assert.deepEqual(calls, [
    "start",
    "complete",
    "create-rag:wrk_1:doc_1:job_1",
    "enqueue-rag:wrk_1:doc_1:rag_job_1:2",
  ]);
});

test("runProductionExtractionJob queues the guided authoring workflow after extraction completes", async () => {
  const enqueued: unknown[] = [];
  await runProductionExtractionJob(
    { documentId: "doc-1", extractionJobId: "extract-1", workspaceId: "ws-1" },
    {
      extractPdfPages: async () => [{ charCount: 7, imageCount: 0, pageNumber: 1, tables: [], text: "BRAKES" }],
      repository: {
        completeExtractionJob: async () => {},
        createKnowledgeAuthoringRunAfterExtraction: async () => ({ documentId: "doc-1", id: "authoring-1", workspaceId: "ws-1" }),
        failExtractionJob: async () => {},
        getPrimaryDocumentObject: async () => ({ objectKey: "opaque.pdf" }),
        startExtractionJob: async () => {},
      },
      storage: { getObject: async () => Buffer.from("%PDF-") },
      knowledgeAuthoringQueue: { enqueue: async (payload) => { enqueued.push(payload); } },
    },
  );
  assert.deepEqual(enqueued, [{ documentId: "doc-1", runId: "authoring-1", workspaceId: "ws-1" }]);
});

test("runProductionExtractionJob normalizes malformed PDF failures", async () => {
  let failedCode = "";
  const repository = {
    completeExtractionJob: async () => {},
    failExtractionJob: async (input: { error: { code: string } }) => {
      failedCode = input.error.code;
    },
    getPrimaryDocumentObject: async () => ({
      objectKey: "workspaces/wrk_1/documents/doc_1/original/obj_1.pdf",
    }),
    startExtractionJob: async () => {},
  };
  const storage = {
    getObject: async () => Buffer.from("%PDF-1.7\n"),
  };

  await runProductionExtractionJob(
    { documentId: "doc_1", extractionJobId: "job_1", workspaceId: "wrk_1" },
    {
      extractPdfPages: async () => {
        throw new Error("invalid xref table");
      },
      repository,
      storage,
    },
  );

  assert.equal(failedCode, "malformed_pdf");
});
