import { createHash } from "node:crypto";

import { getTokenCounter, type TokenCounter } from "./rag-tokenizer.ts";
import type { RagChunkInput, RagChunkRecord } from "./rag-types.ts";

const TARGET_TOKENS = 800;
const MAX_TOKENS = 1200;
const OVERLAP_TOKENS = 120;

type PageUnit = {
  pageNumber: number;
  text: string;
  tokenCount: number;
};

export function chunkExtractedPages(
  input: RagChunkInput & { tokenCounter?: TokenCounter },
): RagChunkRecord[] {
  const tokenCounter = input.tokenCounter ?? getTokenCounter();
  const pageUnits = input.pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text.trim(),
      tokenCount: tokenCounter.count(page.text),
    }));

  const chunks: RagChunkRecord[] = [];
  const emittedHashes = new Set<string>();
  let buffer: PageUnit[] = [];
  let bufferTokens = 0;

  for (const unit of pageUnits) {
    if (buffer.length > 0 && bufferTokens + unit.tokenCount > TARGET_TOKENS) {
      emitChunk(input, chunks, buffer, tokenCounter, emittedHashes);
      buffer = createOverlapBuffer(buffer);
      bufferTokens = sumTokenCounts(buffer);
    }

    buffer.push(unit);
    bufferTokens += unit.tokenCount;

    if (bufferTokens >= MAX_TOKENS) {
      emitChunk(input, chunks, buffer, tokenCounter, emittedHashes);
      buffer = createOverlapBuffer(buffer);
      bufferTokens = sumTokenCounts(buffer);
    }
  }

  if (buffer.length > 0) {
    emitChunk(input, chunks, buffer, tokenCounter, emittedHashes);
  }

  return chunks;
}

function emitChunk(
  input: RagChunkInput,
  chunks: RagChunkRecord[],
  pages: PageUnit[],
  tokenCounter: TokenCounter,
  emittedHashes: Set<string>,
) {
  const chunk = createChunk(input, chunks.length, pages, tokenCounter);

  if (emittedHashes.has(chunk.contentHash)) {
    return;
  }

  emittedHashes.add(chunk.contentHash);
  chunks.push(chunk);
}

function createChunk(
  input: RagChunkInput,
  ordinal: number,
  pages: PageUnit[],
  tokenCounter: TokenCounter,
): RagChunkRecord {
  const sourcePageNumbers = [...new Set(pages.map((page) => page.pageNumber))];
  const text = pages.map((page) => page.text).join("\n\n");
  const contentHash = hashText(text);
  const pageStart = Math.min(...sourcePageNumbers);
  const pageEnd = Math.max(...sourcePageNumbers);

  return {
    chunkOrdinal: ordinal,
    contentHash,
    documentId: input.documentId,
    headingPath: inferHeadingPath(text),
    id: `rag_${input.documentId}_${pageStart}_${ordinal}_${contentHash.slice(0, 12)}`,
    indexJobId: input.indexJobId,
    indexVersion: input.indexVersion,
    pageEnd,
    pageStart,
    reviewStatus: "raw_extracted",
    sourcePageNumbers,
    text,
    tokenCount: tokenCounter.count(text),
    workspaceId: input.workspaceId,
  };
}

function createOverlapBuffer(pages: PageUnit[]) {
  const overlap: PageUnit[] = [];
  let tokenCount = 0;

  for (const page of [...pages].reverse()) {
    if (tokenCount + page.tokenCount > OVERLAP_TOKENS && overlap.length > 0) {
      break;
    }

    overlap.unshift(page);
    tokenCount += page.tokenCount;
  }

  return overlap;
}

function inferHeadingPath(text: string): string[] {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ? [firstLine.slice(0, 120)] : [];
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function sumTokenCounts(pages: PageUnit[]) {
  return pages.reduce((sum, page) => sum + page.tokenCount, 0);
}
