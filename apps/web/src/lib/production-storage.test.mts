import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  buildDocumentObjectKey,
  streamObjectToFile,
} from "./production-storage.ts";

test("buildDocumentObjectKey scopes opaque PDFs by workspace and document", () => {
  const key = buildDocumentObjectKey({
    documentId: "doc_123",
    objectId: "018f4f8a-39a0-7f09-912e-85b55f99a999",
    workspaceId: "wrk_abc",
  });

  assert.equal(
    key,
    "workspaces/wrk_abc/documents/doc_123/original/018f4f8a-39a0-7f09-912e-85b55f99a999.pdf",
  );
  assert.equal(key.includes("manual.pdf"), false);
  assert.equal(key.includes(".."), false);
  assert.equal(key.includes("\\"), false);
});

test("buildDocumentObjectKey rejects unsafe ids before storage access", () => {
  assert.throws(
    () =>
      buildDocumentObjectKey({
        documentId: "../doc",
        objectId: "018f4f8a-39a0-7f09-912e-85b55f99a999",
        workspaceId: "wrk_abc",
      }),
    /unsafe_object_key_segment/,
  );
});

test("streamObjectToFile writes incrementally through the streaming storage API", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-storage-test-"));
  const destination = path.join(scratch, "source.pdf");
  let streamCalls = 0;

  try {
    await streamObjectToFile({
      destination,
      key: "workspaces/ws/documents/doc/original/source.pdf",
      storage: {
        async getObjectStream(key) {
          streamCalls += 1;
          assert.equal(key, "workspaces/ws/documents/doc/original/source.pdf");
          return Readable.from([Buffer.from("%PDF-"), Buffer.from("streamed")]);
        },
      },
    });

    assert.equal(streamCalls, 1);
    assert.equal(await readFile(destination, "utf8"), "%PDF-streamed");
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
});
