import assert from "node:assert/strict";
import test from "node:test";

import {
  requestKnowledgeBundleDeletion,
  runKnowledgeBundleDeletionJob,
} from "./knowledge-bundle-deletion.ts";

test("request immediately unassigns documents and deactivates RAG without touching source objects", async () => {
  const previousBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "production";
  const calls: Array<{ name: string; value?: unknown }> = [];
  const job = {
    bundleId: "kb_1",
    id: "kbd_1",
    workspaceId: "wrk_1",
  };
  const tx = {
    document: { async updateMany(args: unknown) { calls.push({ name: "unassign", value: args }); } },
    knowledgeBundle: { async update(args: unknown) { calls.push({ name: "mark-deleting", value: args }); } },
    knowledgeBundleDeletionJob: { async create() { calls.push({ name: "create-job" }); return job; } },
    ragChunk: { async updateMany(args: unknown) { calls.push({ name: "deactivate-rag", value: args }); } },
  };
  const db = {
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) { return callback(tx); },
    knowledgeBundle: {
      async findFirst() {
        return { documents: [{ id: "doc_1", title: "Manual" }], id: "kb_1", name: "Cars" };
      },
    },
    knowledgeBundleDeletionJob: { async findUnique() { return null; } },
  };
  try {
    const result = await requestKnowledgeBundleDeletion({
      actorId: "member_1",
      bundleId: "kb_1",
      db: db as never,
      enqueue: async (payload) => calls.push({ name: "enqueue", value: payload }),
      workspaceId: "wrk_1",
    });
    assert.equal(result.id, "kbd_1");
    assert.deepEqual(calls.map((call) => call.name), ["create-job", "mark-deleting", "deactivate-rag", "unassign", "enqueue"]);
    assert.deepEqual((calls.find((call) => call.name === "unassign")!.value as { data: unknown }).data, {
      knowledgeBundleId: null,
      ragStatus: "not_indexed",
    });
  } finally {
    if (previousBackend === undefined) delete process.env.AV_OKF_BACKEND;
    else process.env.AV_OKF_BACKEND = previousBackend;
  }
});

test("worker removes knowledge products while preserving document and extraction records", async () => {
  const calls: string[] = [];
  const job = {
    bundleId: "kb_1",
    bundleName: "Cars",
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    id: "kbd_1",
    manifest: {
      bundleId: "kb_1",
      bundleName: "Cars",
      documentIds: ["doc_1"],
      documentTitles: ["Manual"],
      requestedAt: "2026-07-21T00:00:00.000Z",
      workspaceId: "wrk_1",
    },
    requestedBy: "usr_1",
    startedAt: null,
    status: "queued",
    workspaceId: "wrk_1",
  };
  const tx = {
    bundleDeletionAudit: {
      async create() { calls.push("create-audit"); },
      async findFirst() { return null; },
    },
    chatSession: {
      async updateMany() { calls.push("promote-chat-scope"); },
    },
    chatSessionKnowledgeBundle: {
      async findFirst() { return null; },
      async findMany() {
        return [{ sessionId: "chat_1" }, { sessionId: "chat_2" }];
      },
    },
    document: { async updateMany() { calls.push("preserve-unassigned-documents"); } },
    knowledgeBundle: { async deleteMany() { calls.push("delete-bundle-row"); } },
    ragChunk: { async count() { return 3; } },
    ragIndexJob: { async deleteMany() { calls.push("delete-rag-indexes"); } },
    topicDiscoveryJob: { async deleteMany() { calls.push("delete-discovery"); } },
    topicRecord: { async count() { return 4; } },
  };
  const db = {
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) { return callback(tx); },
    knowledgeBundleDeletionJob: {
      async findUnique() { return job; },
      async update(args: { data: { status: string } }) { calls.push(`job-${args.data.status}`); return job; },
      async updateMany() { calls.push("job-failed"); },
    },
  };

  await runKnowledgeBundleDeletionJob(
    { jobId: job.id },
    {
      db: db as never,
      async removeBundleDirectory() { calls.push("delete-okf-directory"); },
      async writeVault() { calls.push("write-vault"); },
    },
  );

  assert.deepEqual(calls, [
    "job-running",
    "delete-discovery",
    "delete-rag-indexes",
    "preserve-unassigned-documents",
    "create-audit",
    "delete-bundle-row",
    "promote-chat-scope",
    "promote-chat-scope",
    "delete-okf-directory",
    "write-vault",
    "job-completed",
  ]);
  assert.equal(calls.includes("delete-document"), false);
  assert.equal(calls.includes("delete-object"), false);
  assert.equal(calls.includes("delete-extraction"), false);
});

test("cross-workspace repeat request is rejected", async () => {
  const previousBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "production";
  try {
    await assert.rejects(
      requestKnowledgeBundleDeletion({
        actorId: "usr_2",
        bundleId: "kb_1",
        db: {
          knowledgeBundleDeletionJob: {
            async findUnique() { return { id: "job_1", workspaceId: "wrk_other" }; },
          },
        } as never,
        enqueue: async () => {},
        workspaceId: "wrk_1",
      }),
      /knowledge_bundle_workspace_mismatch/,
    );
  } finally {
    if (previousBackend === undefined) delete process.env.AV_OKF_BACKEND;
    else process.env.AV_OKF_BACKEND = previousBackend;
  }
});

test("a request that loses the active-bundle race reuses the winning deletion job", async () => {
  const previousBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "production";
  let lookupCount = 0;
  const enqueued: string[] = [];
  try {
    const result = await requestKnowledgeBundleDeletion({
      actorId: "member_1",
      bundleId: "kb_1",
      db: {
        knowledgeBundle: { async findFirst() { return null; } },
        knowledgeBundleDeletionJob: {
          async findUnique() {
            lookupCount += 1;
            return lookupCount === 1
              ? null
              : { id: "job_winner", workspaceId: "wrk_1" };
          },
        },
      } as never,
      enqueue: async ({ jobId }) => { enqueued.push(jobId); },
      workspaceId: "wrk_1",
    });
    assert.equal(result.id, "job_winner");
    assert.deepEqual(enqueued, ["job_winner"]);
  } finally {
    if (previousBackend === undefined) delete process.env.AV_OKF_BACKEND;
    else process.env.AV_OKF_BACKEND = previousBackend;
  }
});
