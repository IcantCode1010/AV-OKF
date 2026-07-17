import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runKnowledgeBundleDeletionJob } from "./knowledge-bundle-deletion.ts";
import { resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";

test("durable bundle deletion removes objects, files, row, and leaves a minimal audit", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "okf-vault-delete-"));
  const previousRoot = process.env.AV_OKF_KNOWLEDGE_ROOT;
  process.env.AV_OKF_KNOWLEDGE_ROOT = vault;
  const root = resolveKnowledgeBundleRoot({ bundleId: "kb_1", workspaceId: "wrk_1" });
  await mkdir(root, { recursive: true });
  const deletedObjects: string[] = [];
  const calls: string[] = [];
  const bundle = {
    _count: { chatSessions: 2, coverageLinks: 3, documents: 1, topics: 4 },
    documents: [{ objects: [{ objectKey: "workspaces/wrk_1/documents/doc_1/original/object.pdf" }] }],
    id: "kb_1",
    name: "Cars",
    status: "deleting",
  };
  const db = {
    knowledgeBundle: { async findFirst() { return bundle; } },
    async $transaction(callback: (tx: unknown) => Promise<void>) {
      await callback({
        bundleDeletionAudit: { async create() { calls.push("audit"); } },
        knowledgeBundle: { async delete() { calls.push("delete-row"); } },
      });
    },
  };
  try {
    await runKnowledgeBundleDeletionJob(
      { actorId: "usr_1", bundleId: "kb_1", workspaceId: "wrk_1" },
      { async deleteObject(key) { deletedObjects.push(key); }, async getObject() { return Buffer.alloc(0); }, async putObject() {} },
      { db: db as never, async writeVault() { calls.push("write-vault"); } },
    );
    assert.deepEqual(deletedObjects, ["workspaces/wrk_1/documents/doc_1/original/object.pdf"]);
    assert.deepEqual(calls, ["audit", "delete-row", "write-vault"]);
    await assert.rejects(access(root));
  } finally {
    if (previousRoot === undefined) delete process.env.AV_OKF_KNOWLEDGE_ROOT;
    else process.env.AV_OKF_KNOWLEDGE_ROOT = previousRoot;
    await rm(vault, { force: true, recursive: true });
  }
});
