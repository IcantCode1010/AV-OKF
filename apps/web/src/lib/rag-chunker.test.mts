import assert from "node:assert/strict";
import test from "node:test";

import { RAG_CHUNK_STRATEGIES, chunkExtractedPages } from "./rag-chunker.ts";
import { createHeuristicTokenCounter } from "./rag-tokenizer.ts";
import type { TokenCounter } from "./rag-tokenizer.ts";

const whitespaceTokenCounter: TokenCounter = {
  kind: "heuristic",
  count(text: string) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  },
};

const smallChunkConfig = {
  maxTokens: 80,
  overlapTokens: 10,
  targetTokens: 50,
  tokenCounter: whitespaceTokenCounter,
};

test("RAG chunk strategy registry names the contextual paragraph chunker", () => {
  assert.deepEqual(RAG_CHUNK_STRATEGIES, [
    {
      description:
        "Splits extracted page text into paragraph units and embeds deterministic document, section, and page context while preserving clean source citations.",
      id: "paragraph-context-v2",
      label: "Paragraph + context (v2)",
    },
  ]);
});

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

test("chunkExtractedPages keeps chunk ids distinct across index versions", () => {
  const baseInput = {
    documentId: "doc_4",
    indexJobId: "job_4",
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

  const first = chunkExtractedPages({ ...baseInput, indexVersion: 1 });
  const second = chunkExtractedPages({ ...baseInput, indexVersion: 2 });

  assert.equal(first[0]?.contentHash, second[0]?.contentHash);
  assert.notEqual(first[0]?.id, second[0]?.id);
});

test("chunkExtractedPages enforces max tokens for one very large page", () => {
  const chunks = chunkExtractedPages({
    documentId: "doc_hard_cap",
    indexJobId: "job_hard_cap",
    indexVersion: 1,
    pages: [
      {
        charCount: 25_000,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: uniqueWords("dense", 5_000),
      },
    ],
    workspaceId: "wrk_1",
    ...smallChunkConfig,
  });

  assert.equal(chunks.length > 1, true);
  assert.equal(
    chunks.every((chunk) => chunk.tokenCount <= smallChunkConfig.maxTokens),
    true,
  );
});

test("chunkExtractedPages preserves every input paragraph in at least one chunk", () => {
  const paragraphs = Array.from(
    { length: 9 },
    (_, index) => `paragraph-${index + 1} ${words(`coverage-${index + 1}`, 14)}`,
  );
  const chunks = chunkExtractedPages({
    documentId: "doc_coverage",
    indexJobId: "job_coverage",
    indexVersion: 1,
    pages: [
      {
        charCount: 3_000,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: paragraphs.join("\n\n"),
      },
    ],
    workspaceId: "wrk_1",
    ...smallChunkConfig,
  });

  for (const paragraph of paragraphs) {
    assert.equal(
      chunks.some((chunk) => chunk.text.includes(paragraph)),
      true,
      `missing paragraph: ${paragraph}`,
    );
  }
});

test("chunkExtractedPages does not emit adjacent chunks fully contained in each other", () => {
  const chunks = chunkExtractedPages({
    documentId: "doc_no_contained",
    indexJobId: "job_no_contained",
    indexVersion: 1,
    pages: ["alpha", "bravo", "charlie"].map((label, index) => ({
      charCount: 200,
      imageCount: 0,
      pageNumber: index + 1,
      tables: [],
      text: `${label} ${words(label, 30)}`,
    })),
    workspaceId: "wrk_1",
    ...smallChunkConfig,
  });

  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1]?.text ?? "";
    const current = chunks[index]?.text ?? "";

    assert.equal(
      previous.includes(current) || current.includes(previous),
      false,
      `contained adjacent chunks at ${index - 1}/${index}`,
    );
  }
});

test("chunkExtractedPages does not carry a whole emitted chunk as overlap", () => {
  const paragraphs = [
    `paragraph-thirty ${words("thirty", 29)}`,
    `paragraph-fifteen ${words("fifteen", 14)}`,
    `paragraph-forty-five ${words("forty-five", 44)}`,
  ];
  const chunks = chunkExtractedPages({
    documentId: "doc_whole_overlap",
    indexJobId: "job_whole_overlap",
    indexVersion: 1,
    maxTokens: 60,
    overlapTokens: 20,
    pages: [
      {
        charCount: 1_000,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: paragraphs.join("\n\n"),
      },
    ],
    targetTokens: 40,
    tokenCounter: whitespaceTokenCounter,
    workspaceId: "wrk_1",
  });

  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1]?.text ?? "";
    const current = chunks[index]?.text ?? "";

    assert.equal(
      previous.includes(current) || current.includes(previous),
      false,
      `contained adjacent chunks at ${index - 1}/${index}`,
    );
  }

  for (const paragraph of paragraphs) {
    assert.equal(
      chunks.some((chunk) => chunk.text.includes(paragraph)),
      true,
      `missing paragraph: ${paragraph}`,
    );
  }
});

test("chunkExtractedPages bounds shared adjacent text by overlap config", () => {
  const chunks = chunkExtractedPages({
    documentId: "doc_overlap",
    indexJobId: "job_overlap",
    indexVersion: 1,
    pages: Array.from({ length: 5 }, (_, index) => ({
      charCount: 200,
      imageCount: 0,
      pageNumber: index + 1,
      tables: [],
      text: `segment-${index + 1} ${words(`shared-${index + 1}`, 30)}`,
    })),
    workspaceId: "wrk_1",
    ...smallChunkConfig,
  });

  for (let index = 1; index < chunks.length; index += 1) {
    const shared = countSharedParagraphTokens(
      chunks[index - 1]?.text ?? "",
      chunks[index]?.text ?? "",
    );

    assert.equal(
      shared <= smallChunkConfig.overlapTokens * 2,
      true,
      `shared ${shared} tokens exceeds overlap bound`,
    );
  }
});

test("chunkExtractedPages preserves citations across page-spanning chunks", () => {
  const chunks = chunkExtractedPages({
    documentId: "doc_citations",
    indexJobId: "job_citations",
    indexVersion: 1,
    pages: [
      {
        charCount: 100,
        imageCount: 0,
        pageNumber: 3,
        tables: [],
        text: `page-three ${words("three", 24)}`,
      },
      {
        charCount: 100,
        imageCount: 0,
        pageNumber: 4,
        tables: [],
        text: `page-four ${words("four", 24)}`,
      },
    ],
    workspaceId: "wrk_1",
    ...smallChunkConfig,
    targetTokens: 70,
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.pageStart, 3);
  assert.equal(chunks[0]?.pageEnd, 4);
  assert.deepEqual(chunks[0]?.sourcePageNumbers, [3, 4]);
});

test("chunkExtractedPages keeps contextual headers out of citation text", () => {
  const [chunk] = chunkExtractedPages({
    documentId: "doc_context",
    documentTitle: "Hydraulic Pump Manual",
    indexJobId: "job_context",
    indexVersion: 1,
    pages: [{
      charCount: 80,
      imageCount: 0,
      pageNumber: 7,
      tables: [],
      text: "Pressure Verification\n\nVerify pressure reaches 3,000 PSI.",
    }],
    tokenCounter: whitespaceTokenCounter,
    workspaceId: "wrk_1",
  });

  assert.equal(chunk?.text.includes("[Document:"), false);
  assert.match(chunk?.embeddingText ?? "", /^\[Document: Hydraulic Pump Manual \| Section: Pressure Verification \| Pages: 7\]/);
  assert.equal(chunk?.tokenCount, whitespaceTokenCounter.count(chunk?.embeddingText ?? ""));
});

test("context changes content hash and chunk id without changing citation text", () => {
  const base = {
    documentId: "doc_context_hash",
    indexJobId: "job_context_hash",
    indexVersion: 1,
    pages: [{ charCount: 20, imageCount: 0, pageNumber: 1, tables: [], text: "Same source text." }],
    tokenCounter: whitespaceTokenCounter,
    workspaceId: "wrk_1",
  };
  const [left] = chunkExtractedPages({ ...base, documentTitle: "Manual A" });
  const [right] = chunkExtractedPages({ ...base, documentTitle: "Manual B" });

  assert.equal(left?.text, right?.text);
  assert.notEqual(left?.contentHash, right?.contentHash);
  assert.notEqual(left?.id, right?.id);
});

test("chunkExtractedPages rejects invalid token limits", () => {
  assert.throws(
    () =>
      chunkExtractedPages({
        documentId: "doc_invalid_config",
        indexJobId: "job_invalid_config",
        indexVersion: 1,
        maxTokens: 80,
        overlapTokens: 50,
        pages: [
          {
            charCount: 20,
            imageCount: 0,
            pageNumber: 1,
            tables: [],
            text: "short text",
          },
        ],
        targetTokens: 50,
        tokenCounter: whitespaceTokenCounter,
        workspaceId: "wrk_1",
      }),
    /invalid_rag_chunk_token_config/,
  );
});

function words(value: string, count: number) {
  return Array.from({ length: count }, () => value).join(" ");
}

function uniqueWords(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`).join(
    " ",
  );
}

function countSharedParagraphTokens(left: string, right: string) {
  const rightParagraphs = new Set(
    right
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
  );

  return left
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && rightParagraphs.has(paragraph))
    .reduce(
      (sum, paragraph) => sum + whitespaceTokenCounter.count(paragraph),
      0,
    );
}
