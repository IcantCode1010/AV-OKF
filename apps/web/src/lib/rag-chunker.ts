import { createHash } from "node:crypto";

import { getTokenCounter, type TokenCounter } from "./rag-tokenizer.ts";
import type { RagChunkInput, RagChunkRecord } from "./rag-types.ts";

const DEFAULT_TARGET_TOKENS = 800;
const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_OVERLAP_TOKENS = 120;

type TextUnit = {
  pageNumber: number;
  text: string;
  tokenCount: number;
};

type ChunkTokenConfig = {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
};

type ChunkExtractedPagesInput = RagChunkInput & {
  maxTokens?: number;
  overlapTokens?: number;
  targetTokens?: number;
  tokenCounter?: TokenCounter;
};

export function chunkExtractedPages(
  input: ChunkExtractedPagesInput,
): RagChunkRecord[] {
  const tokenCounter = input.tokenCounter ?? getTokenCounter();
  const config = resolveChunkConfig(input);
  const textUnits = input.pages.flatMap((page) =>
    page.text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .flatMap((text) =>
        splitUnitToMaxTokens(
          {
            pageNumber: page.pageNumber,
            text,
            tokenCount: tokenCounter.count(text),
          },
          tokenCounter,
          config,
        ),
      ),
  );

  const chunks: RagChunkRecord[] = [];
  const emittedHashes = new Set<string>();
  let buffer: TextUnit[] = [];
  let bufferHasNewContent = false;

  for (const unit of textUnits) {
    const targetCandidate = [...buffer, unit];

    if (
      buffer.length > 0 &&
      bufferHasNewContent &&
      countUnitText(targetCandidate, tokenCounter) > config.targetTokens
    ) {
      emitChunk(input, chunks, buffer, tokenCounter, emittedHashes, config);
      buffer = createOverlapBuffer(buffer, tokenCounter, config);
      bufferHasNewContent = false;
    }

    const maxCandidate = [...buffer, unit];
    if (
      buffer.length > 0 &&
      countUnitText(maxCandidate, tokenCounter) > config.maxTokens
    ) {
      if (bufferHasNewContent) {
        emitChunk(input, chunks, buffer, tokenCounter, emittedHashes, config);
      }
      buffer = [];
      bufferHasNewContent = false;
    }

    buffer.push(unit);
    bufferHasNewContent = true;

    if (countUnitText(buffer, tokenCounter) >= config.maxTokens) {
      emitChunk(input, chunks, buffer, tokenCounter, emittedHashes, config);
      buffer = createOverlapBuffer(buffer, tokenCounter, config);
      bufferHasNewContent = false;
    }
  }

  if (buffer.length > 0 && bufferHasNewContent) {
    emitChunk(input, chunks, buffer, tokenCounter, emittedHashes, config);
  }

  return chunks;
}

function emitChunk(
  input: RagChunkInput,
  chunks: RagChunkRecord[],
  units: TextUnit[],
  tokenCounter: TokenCounter,
  emittedHashes: Set<string>,
  config: ChunkTokenConfig,
) {
  const chunk = createChunk(input, chunks.length, units, tokenCounter);

  if (chunk.tokenCount > config.maxTokens) {
    throw new Error(
      `rag_chunk_exceeds_max_tokens: chunk ${chunk.id} has ${chunk.tokenCount} tokens, max is ${config.maxTokens}`,
    );
  }

  if (emittedHashes.has(chunk.contentHash)) {
    return;
  }

  emittedHashes.add(chunk.contentHash);
  chunks.push(chunk);
}

function createChunk(
  input: RagChunkInput,
  ordinal: number,
  units: TextUnit[],
  tokenCounter: TokenCounter,
): RagChunkRecord {
  const sourcePageNumbers = [...new Set(units.map((unit) => unit.pageNumber))];
  const text = units.map((unit) => unit.text).join("\n\n");
  const contentHash = hashText(text);
  const pageStart = Math.min(...sourcePageNumbers);
  const pageEnd = Math.max(...sourcePageNumbers);

  return {
    chunkOrdinal: ordinal,
    contentHash,
    documentId: input.documentId,
    headingPath: inferHeadingPath(text),
    id: `rag_${input.documentId}_${input.indexVersion}_${pageStart}_${ordinal}_${contentHash.slice(0, 12)}`,
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

function createOverlapBuffer(
  units: TextUnit[],
  tokenCounter: TokenCounter,
  config: ChunkTokenConfig,
) {
  if (config.overlapTokens === 0) {
    return [];
  }

  const overlap: TextUnit[] = [];

  for (const unit of [...units].reverse()) {
    const candidate = [unit, ...overlap];
    const candidateTokens = countUnitText(candidate, tokenCounter);

    if (candidateTokens <= config.overlapTokens) {
      overlap.unshift(unit);
      continue;
    }

    if (
      overlap.length === 0 &&
      candidateTokens <= config.overlapTokens * 2
    ) {
      overlap.unshift(unit);
      continue;
    }

    if (overlap.length > 0 || candidateTokens > config.overlapTokens * 2) {
      break;
    }
  }

  return overlap.length === units.length ? [] : overlap;
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

function splitUnitToMaxTokens(
  unit: TextUnit,
  tokenCounter: TokenCounter,
  config: ChunkTokenConfig,
): TextUnit[] {
  if (unit.tokenCount <= config.maxTokens) {
    return [unit];
  }

  const sentenceUnits = unit.text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) =>
      splitTextByTokenWindows(sentence, unit.pageNumber, tokenCounter, config),
    );

  const packed: TextUnit[] = [];
  let buffer: TextUnit[] = [];

  for (const sentenceUnit of sentenceUnits) {
    const candidate = [...buffer, sentenceUnit];

    if (
      buffer.length > 0 &&
      countUnitText(candidate, tokenCounter) > config.targetTokens
    ) {
      packed.push(createPackedUnit(buffer, tokenCounter));
      buffer = [];
    }

    buffer.push(sentenceUnit);
  }

  if (buffer.length > 0) {
    packed.push(createPackedUnit(buffer, tokenCounter));
  }

  return packed.flatMap((packedUnit) =>
    packedUnit.tokenCount <= config.maxTokens
      ? [packedUnit]
      : splitTextByTokenWindows(
          packedUnit.text,
          packedUnit.pageNumber,
          tokenCounter,
          config,
        ),
  );
}

function splitTextByTokenWindows(
  text: string,
  pageNumber: number,
  tokenCounter: TokenCounter,
  config: ChunkTokenConfig,
): TextUnit[] {
  const tokenCount = tokenCounter.count(text);

  if (tokenCount <= config.maxTokens) {
    return [{ pageNumber, text, tokenCount }];
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return splitLongTextByCharacters(text, pageNumber, tokenCounter, config);
  }

  const units: TextUnit[] = [];
  let buffer: string[] = [];

  for (const word of words) {
    if (tokenCounter.count(word) > config.maxTokens) {
      if (buffer.length > 0) {
        units.push(createTextUnit(buffer.join(" "), pageNumber, tokenCounter));
        buffer = [];
      }
      units.push(
        ...splitLongTextByCharacters(word, pageNumber, tokenCounter, config),
      );
      continue;
    }

    const candidate = [...buffer, word].join(" ");
    if (
      buffer.length > 0 &&
      tokenCounter.count(candidate) > config.targetTokens
    ) {
      units.push(createTextUnit(buffer.join(" "), pageNumber, tokenCounter));
      buffer = [word];
      continue;
    }

    buffer.push(word);
  }

  if (buffer.length > 0) {
    units.push(createTextUnit(buffer.join(" "), pageNumber, tokenCounter));
  }

  return units.flatMap((unit) =>
    unit.tokenCount <= config.maxTokens
      ? [unit]
      : splitLongTextByCharacters(unit.text, pageNumber, tokenCounter, config),
  );
}

function splitLongTextByCharacters(
  text: string,
  pageNumber: number,
  tokenCounter: TokenCounter,
  config: ChunkTokenConfig,
): TextUnit[] {
  const units: TextUnit[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    const splitIndex = findLargestPrefixIndex(
      remaining,
      tokenCounter,
      config.targetTokens,
    );
    const prefix = remaining.slice(0, splitIndex).trim();

    if (prefix.length === 0) {
      throw new Error("rag_chunk_split_failed: unable to split oversized text");
    }

    units.push(createTextUnit(prefix, pageNumber, tokenCounter));
    remaining = remaining.slice(splitIndex).trim();
  }

  return units;
}

function findLargestPrefixIndex(
  text: string,
  tokenCounter: TokenCounter,
  targetTokens: number,
) {
  let low = 1;
  let high = text.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const tokenCount = tokenCounter.count(text.slice(0, mid));

    if (tokenCount <= targetTokens) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.max(best, 1);
}

function createPackedUnit(
  units: TextUnit[],
  tokenCounter: TokenCounter,
): TextUnit {
  return createTextUnit(units.map((unit) => unit.text).join(" "), units[0]!.pageNumber, tokenCounter);
}

function createTextUnit(
  text: string,
  pageNumber: number,
  tokenCounter: TokenCounter,
): TextUnit {
  const trimmed = text.trim();

  return {
    pageNumber,
    text: trimmed,
    tokenCount: tokenCounter.count(trimmed),
  };
}

function countUnitText(units: TextUnit[], tokenCounter: TokenCounter) {
  if (units.length === 0) {
    return 0;
  }

  return tokenCounter.count(units.map((unit) => unit.text).join("\n\n"));
}

function resolveChunkConfig(input: ChunkExtractedPagesInput): ChunkTokenConfig {
  const targetTokens =
    input.targetTokens ??
    readEnvInteger("RAG_CHUNK_TARGET_TOKENS", DEFAULT_TARGET_TOKENS);
  const maxTokens =
    input.maxTokens ?? readEnvInteger("RAG_CHUNK_MAX_TOKENS", DEFAULT_MAX_TOKENS);
  const overlapTokens =
    input.overlapTokens ??
    readEnvInteger("RAG_CHUNK_OVERLAP_TOKENS", DEFAULT_OVERLAP_TOKENS);

  if (
    !(
      Number.isInteger(maxTokens) &&
      Number.isInteger(targetTokens) &&
      Number.isInteger(overlapTokens) &&
      maxTokens >= targetTokens &&
      targetTokens > overlapTokens &&
      overlapTokens >= 0
    )
  ) {
    throw new Error(
      `invalid_rag_chunk_token_config: expected max >= target > overlap >= 0, received max=${maxTokens}, target=${targetTokens}, overlap=${overlapTokens}`,
    );
  }

  return { maxTokens, overlapTokens, targetTokens };
}

function readEnvInteger(name: string, fallback: number) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(
      `invalid_rag_chunk_token_config: ${name} must be an integer, received ${value}`,
    );
  }

  return parsed;
}
