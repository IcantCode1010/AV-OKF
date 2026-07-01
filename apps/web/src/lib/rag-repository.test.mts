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
