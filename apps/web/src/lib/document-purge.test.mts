import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_DOCUMENTS_PURGE_CONFIRMATION,
  buildDocumentPurgeInventory,
  isRuntimeDocumentObjectKey,
  parseDocumentPurgeOptions,
  shouldPurgeRuntimeKnowledgeFile,
} from "./document-purge.ts";

test("document purge defaults to a non-mutating dry run", () => {
  const options = parseDocumentPurgeOptions([]);

  assert.equal(options.apply, false);
  assert.equal(options.confirmation, null);
  assert.ok(options.pollMs > 0);
  assert.ok(options.timeoutMs > options.pollMs);
});

test("document purge requires the exact destructive confirmation", () => {
  assert.throws(
    () => parseDocumentPurgeOptions(["--apply"]),
    /document_purge_apply_requires/,
  );
  assert.throws(
    () => parseDocumentPurgeOptions(["--apply", "--confirm", "DELETE"]),
    /document_purge_apply_requires/,
  );
  assert.equal(
    parseDocumentPurgeOptions([
      "--apply",
      "--confirm",
      ALL_DOCUMENTS_PURGE_CONFIRMATION,
    ]).apply,
    true,
  );
});

test("document purge inventory is deterministic and empty input is idempotent", () => {
  const inventory = buildDocumentPurgeInventory([
    {
      knowledgeBundleId: "bundle_b",
      objectCount: 1,
      topicCount: 3,
      workspaceId: "workspace_b",
    },
    {
      knowledgeBundleId: null,
      objectCount: 2,
      topicCount: 0,
      workspaceId: "workspace_a",
    },
    {
      knowledgeBundleId: "bundle_a",
      objectCount: 1,
      topicCount: 2,
      workspaceId: "workspace_a",
    },
  ]);

  assert.deepEqual(inventory, {
    documentCount: 3,
    objectCount: 4,
    topicCount: 5,
    workspaces: [
      {
        documentCount: 2,
        objectCount: 3,
        topicCount: 2,
        workspaceId: "workspace_a",
      },
      {
        documentCount: 1,
        objectCount: 1,
        topicCount: 3,
        workspaceId: "workspace_b",
      },
    ],
  });
  assert.deepEqual(buildDocumentPurgeInventory([]), {
    documentCount: 0,
    objectCount: 0,
    topicCount: 0,
    workspaces: [],
  });
});

test("document purge rejects invalid polling controls", () => {
  assert.throws(
    () => parseDocumentPurgeOptions(["--poll-ms", "0"]),
    /document_purge_invalid_poll_ms/,
  );
  assert.throws(
    () => parseDocumentPurgeOptions(["--timeout-ms", "later"]),
    /document_purge_invalid_timeout_ms/,
  );
});

test("document purge keeps bundle control files and migration history", () => {
  assert.equal(shouldPurgeRuntimeKnowledgeFile("index.md"), false);
  assert.equal(shouldPurgeRuntimeKnowledgeFile("log.md"), false);
  assert.equal(
    shouldPurgeRuntimeKnowledgeFile("references/history/pre-v0.2.md"),
    false,
  );
  assert.equal(
    shouldPurgeRuntimeKnowledgeFile("concepts/procedure/check.md"),
    true,
  );
  assert.equal(
    shouldPurgeRuntimeKnowledgeFile("references/sources/manual.md"),
    true,
  );
  assert.throws(
    () => shouldPurgeRuntimeKnowledgeFile("../outside.md"),
    /document_purge_unsafe_knowledge_path/,
  );
});

test("document purge identifies document object keys across workspaces", () => {
  assert.equal(
    isRuntimeDocumentObjectKey(
      "workspaces/workspace-a/documents/document-a/original/source.pdf",
    ),
    true,
  );
  assert.equal(
    isRuntimeDocumentObjectKey("workspaces/workspace-a/profile/avatar.png"),
    false,
  );
});
