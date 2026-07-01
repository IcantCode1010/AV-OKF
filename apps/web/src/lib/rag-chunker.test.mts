import assert from "node:assert/strict";
import test from "node:test";

import { chunkExtractedPages } from "./rag-chunker.ts";
import { createHeuristicTokenCounter } from "./rag-tokenizer.ts";

test("chunkExtractedPages preserves source page coverage", () => {
  const chunks = chunkExtractedPages({
    documentId: "doc_1",
    indexJobId: "job_1",
    indexVersion: 1,
    tokenCounter: createHeuristicTokenCounter(),
    workspaceId: "wrk_1",
    pages: [
      {
        charCount: 32,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: "ATA 24 ELECTRICAL POWER\nGenerator control unit overview.",
      },
      {
        charCount: 42,
        imageCount: 0,
        pageNumber: 2,
        tables: [],
        text: "Generator control unit fault isolation procedure.",
      },
    ],
  });

  assert.equal(chunks.length > 0, true);
  assert.deepEqual(chunks[0]?.sourcePageNumbers, [1, 2]);
  assert.equal(chunks[0]?.pageStart, 1);
  assert.equal(chunks[0]?.pageEnd, 2);
  assert.equal(chunks[0]?.reviewStatus, "raw_extracted");
});

test("chunkExtractedPages is independent from topic generation sizing", () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({
    charCount: 400,
    imageCount: 0,
    pageNumber: index + 1,
    tables: [],
    text: `SECTION ${index + 1}\n${"retrieval text ".repeat(60)}`,
  }));

  const chunks = chunkExtractedPages({
    documentId: "doc_2",
    indexJobId: "job_2",
    indexVersion: 1,
    pages,
    tokenCounter: createHeuristicTokenCounter(),
    workspaceId: "wrk_1",
  });

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.every((chunk) => chunk.tokenCount <= 1200), true);
});

test("chunkExtractedPages creates stable content hashes", () => {
  const input = {
    documentId: "doc_3",
    indexJobId: "job_3",
    indexVersion: 1,
    tokenCounter: createHeuristicTokenCounter(),
    workspaceId: "wrk_1",
    pages: [
      {
        charCount: 20,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: "Stable extracted text.",
      },
    ],
  };

  const first = chunkExtractedPages(input);
  const second = chunkExtractedPages(input);

  assert.equal(first[0]?.contentHash, second[0]?.contentHash);
  assert.equal(first[0]?.id, second[0]?.id);
});
