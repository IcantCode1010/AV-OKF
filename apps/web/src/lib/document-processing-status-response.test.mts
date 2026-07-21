import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentProcessingStatusResponse } from "./document-processing-status-response.ts";

const context = { role: "admin" as const, userId: "usr_1", workspaceId: "wrk_1" };

test("processing status returns a private no-store fingerprint", async () => {
  const response = await createDocumentProcessingStatusResponse("doc_1", {
    getContext: async () => context,
    getSnapshot: async () => ({ active: true, fingerprint: "state-v2" }),
    getWorkspaceId: async () => "wrk_1",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    active: true,
    fingerprint: "state-v2",
  });
});

test("processing status rejects cross-workspace and missing documents", async () => {
  let fingerprintReads = 0;
  const dependencies = {
    getContext: async () => context,
    getSnapshot: async () => {
      fingerprintReads += 1;
      return { active: true, fingerprint: "secret-state" };
    },
  };
  const foreign = await createDocumentProcessingStatusResponse("doc_foreign", {
    ...dependencies,
    getWorkspaceId: async () => "wrk_other",
  });
  const missing = await createDocumentProcessingStatusResponse("doc_missing", {
    ...dependencies,
    getWorkspaceId: async () => undefined,
  });
  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(fingerprintReads, 0);
});

test("workspace-less local records require an explicit opt-out", async () => {
  const response = await createDocumentProcessingStatusResponse("doc_local", {
    allowMissingWorkspace: true,
    getContext: async () => context,
    getSnapshot: async () => ({ active: false, fingerprint: "local-state" }),
    getWorkspaceId: async () => undefined,
  });
  assert.equal(response.status, 200);
});
