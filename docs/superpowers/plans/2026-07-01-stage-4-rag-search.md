# Stage 4 RAG Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Stage 4 RAG indexing and retrieval so extracted PDF pages become searchable chunks with citation-ready page coverage.

**Architecture:** RAG indexing runs automatically after extraction completes and remains separate from Stage 3 topic detection. Production uses Postgres + pgvector, Redis/BullMQ indexing jobs, and OpenAI `text-embedding-3-small`; local/tests use deterministic embeddings and never require an API key. OKF frontmatter remains the source of truth for approved `covered_rag_chunk_ids`/`coverage_type`; any Postgres coverage table is a synced projection.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, pgvector, BullMQ, OpenAI embeddings API, deterministic test embeddings, Node test runner.

---

## Scope

Stage 4 includes only:

- RAG chunking from `extracted_pages`
- embedding provider abstraction
- OpenAI production embedding provider
- deterministic local/test embedding provider
- token budget pre-checks
- pgvector storage
- durable RAG indexing jobs
- retrieval service
- minimal search route/UI
- tests and docs for the above

Stage 4 excludes:

- OKF export implementation
- chat agent
- query router
- validation agent
- new deployment targets
- unrelated infrastructure

## Approved Decisions

- Embedding model: `text-embedding-3-small`
- Dimensions: `1536`
- Automated tests: deterministic local embeddings only
- Token caps:
  - `RAG_EMBEDDING_MAX_TOKENS_PER_DOCUMENT=250000`
  - `RAG_EMBEDDING_MAX_TOKENS_PER_WORKSPACE_DAY=1000000`
  - `RAG_EMBEDDING_MAX_TOKENS_GLOBAL_DAY=5000000`
- Budget enforcement: inside indexer before any embedding provider call
- Budget cap behavior: hard failure, no truncation
- Budget failure code: `embedding_budget_exceeded`
- Queue behavior for budget failure: throw BullMQ `UnrecoverableError`, no retry
- Production token counting: `js-tiktoken` with `cl100k_base`; local tests may use heuristic counting
- OKF coverage source of truth: approved OKF Markdown frontmatter
- DB coverage table: derived query projection only

## Files

Create:

- `apps/web/src/lib/rag-types.ts`
- `apps/web/src/lib/rag-tokenizer.ts`
- `apps/web/src/lib/rag-tokenizer.test.mts`
- `apps/web/src/lib/rag-chunker.ts`
- `apps/web/src/lib/rag-chunker.test.mts`
- `apps/web/src/lib/embedding-provider.ts`
- `apps/web/src/lib/embedding-provider.test.mts`
- `apps/web/src/lib/rag-budget.ts`
- `apps/web/src/lib/rag-budget.test.mts`
- `apps/web/src/lib/rag-repository.ts`
- `apps/web/src/lib/rag-repository.test.mts`
- `apps/web/src/lib/rag-queue.ts`
- `apps/web/src/lib/rag-queue.test.mts`
- `apps/web/src/lib/rag-indexer.ts`
- `apps/web/src/lib/rag-indexer.test.mts`
- `apps/web/src/lib/rag-retrieval.ts`
- `apps/web/src/lib/rag-retrieval.test.mts`
- `apps/web/src/lib/rag-backend.ts`
- `apps/web/src/app/(app)/search/page.tsx`
- `apps/web/src/components/search-results.tsx`
- `apps/web/src/components/search-form.tsx`
- `apps/web/prisma/migrations/20260701110000_stage_4_rag_search/migration.sql`

Modify:

- `apps/web/prisma/schema.prisma`
- `apps/web/package.json`
- `apps/web/pnpm-lock.yaml`
- `apps/web/src/lib/production-worker.ts`
- `apps/web/src/worker/extraction-worker.ts`
- `apps/web/src/lib/production-repository.ts`
- `apps/web/src/components/app-shell.tsx`
- `docker-compose.yml`
- `apps/web/.env.example`
- `README.md`
- `docs/roadmap/mvp-stages.md`

## Data Model

Add to `apps/web/prisma/schema.prisma`:

```prisma
model RagIndexJob {
  id             String    @id @default(cuid())
  workspaceId    String
  documentId     String
  extractionJobId String?
  status         String
  indexVersion   Int
  tokenEstimate  Int       @default(0)
  attempts       Int       @default(0)
  errorCode      String?
  errorMessage   String?
  queuedAt       DateTime  @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  document       Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  chunks         RagChunk[]

  @@index([status, queuedAt])
  @@index([workspaceId, documentId, status])
}

model RagChunk {
  id                String       @id
  workspaceId       String
  documentId        String
  indexJobId        String
  indexVersion      Int
  chunkOrdinal      Int
  text              String       @db.Text
  contentHash       String
  tokenCount        Int
  pageStart         Int
  pageEnd           Int
  sourcePageNumbers Int[]
  headingPath       String[]
  reviewStatus      String       @default("raw_extracted")
  isActive          Boolean      @default(false)
  document          Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  indexJob          RagIndexJob  @relation(fields: [indexJobId], references: [id], onDelete: Cascade)
  embedding         RagEmbedding?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  @@unique([documentId, indexVersion, chunkOrdinal])
  @@index([workspaceId, documentId, isActive])
  @@index([workspaceId, isActive])
  @@index([contentHash])
}

model RagEmbedding {
  id          String   @id @default(cuid())
  workspaceId String
  chunkId     String   @unique
  model       String
  dimensions  Int
  tokenCount  Int
  embedding   Unsupported("vector(1536)")
  chunk       RagChunk @relation(fields: [chunkId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@index([workspaceId, model])
}

model OkfConceptChunkLink {
  id           String   @id @default(cuid())
  workspaceId  String
  okfConceptId String
  chunkId      String
  coverageType String
  source       String   @default("okf_frontmatter")
  syncedAt     DateTime @default(now())

  @@unique([workspaceId, okfConceptId, chunkId])
  @@index([workspaceId, chunkId])
}
```

Also add relations to existing models:

```prisma
model Workspace {
  ragIndexJobs         RagIndexJob[]
}

model Document {
  ragStatus            String        @default("not_indexed")
  ragIndexVersion      Int           @default(0)
  ragIndexJobs         RagIndexJob[]
  ragChunks            RagChunk[]
}
```

Migration SQL must include:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

For MVP exact search, do not add HNSW in Stage 4.

## Task 1: Add RAG Types

**Files:**

- Create: `apps/web/src/lib/rag-types.ts`
- Test: no standalone test for types

- [ ] **Step 1: Create shared RAG types**

Create `apps/web/src/lib/rag-types.ts`:

```ts
import type { ExtractedPageRecord } from "./document-vault.ts";

export type RagIndexStatus =
  | "not_indexed"
  | "queued"
  | "running"
  | "indexed"
  | "index_failed";

export type RagIndexJobStatus = "queued" | "running" | "completed" | "failed";

export type RagIndexErrorCode =
  | "chunking_failed"
  | "embedding_budget_exceeded"
  | "embedding_provider_failed"
  | "vector_store_failed"
  | "indexing_failed";

export type RagChunkRecord = {
  id: string;
  workspaceId: string;
  documentId: string;
  indexJobId: string;
  indexVersion: number;
  chunkOrdinal: number;
  text: string;
  contentHash: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
  sourcePageNumbers: number[];
  headingPath: string[];
  reviewStatus: "raw_extracted";
};

export type RagChunkInput = {
  documentId: string;
  indexJobId: string;
  indexVersion: number;
  pages: ExtractedPageRecord[];
  workspaceId: string;
};

export type RetrievalMode = "hybrid" | "vector" | "keyword";

export type RetrievalRequest = {
  filters?: {
    documentIds?: string[];
    pageNumbers?: number[];
    reviewStatus?: string[];
    sourceTypes?: string[];
  };
  mode: RetrievalMode;
  query: string;
  topK: number;
  workspaceId: string;
};

export type RetrievalResult = {
  chunkId: string;
  coveredByOkfConceptIds: string[];
  documentId: string;
  documentTitle: string;
  pageEnd: number;
  pageStart: number;
  retrievalMode: RetrievalMode;
  score: number;
  sourcePageNumbers: number[];
  text: string;
};
```

- [ ] **Step 2: Run typecheck through build**

Run:

```bash
pnpm --dir apps/web build
```

Expected: build still passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/rag-types.ts
git commit -m "Add RAG domain types"
```

## Task 2: Add Token Counter And Page-Aware Chunker

**Files:**

- Create: `apps/web/src/lib/rag-tokenizer.ts`
- Create: `apps/web/src/lib/rag-tokenizer.test.mts`
- Create: `apps/web/src/lib/rag-chunker.ts`
- Create: `apps/web/src/lib/rag-chunker.test.mts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/pnpm-lock.yaml`

- [ ] **Step 1: Install tokenizer**

Run:

```bash
pnpm --dir apps/web add js-tiktoken
```

Expected: `js-tiktoken` appears in `apps/web/package.json`.

- [ ] **Step 2: Write token counter tests**

Create `apps/web/src/lib/rag-tokenizer.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeuristicTokenCounter,
  createTiktokenTokenCounter,
  getTokenCounter,
} from "./rag-tokenizer.ts";

test("heuristic token counter is available for deterministic local tests", () => {
  const counter = createHeuristicTokenCounter();

  assert.equal(counter.kind, "heuristic");
  assert.equal(counter.count("ATA 24 generator-control unit"), 6);
});

test("tiktoken token counter handles technical strings without word heuristics", () => {
  const counter = createTiktokenTokenCounter();
  const technical = "ATA-24 GCU P/N 1159SCL402-17 GEN-OFF-BUS";

  assert.equal(counter.kind, "tiktoken");
  assert.equal(counter.count(technical) > technical.split(/\s+/).length, true);
});

test("getTokenCounter uses tiktoken in production embedding path", () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "production";

  const counter = getTokenCounter();

  assert.equal(counter.kind, "tiktoken");
  process.env.AV_OKF_BACKEND = originalBackend;
});
```

- [ ] **Step 3: Write chunker tests**

Create `apps/web/src/lib/rag-chunker.test.mts`:

```ts
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
  assert.deepEqual(chunks[0].sourcePageNumbers, [1, 2]);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 2);
  assert.equal(chunks[0].reviewStatus, "raw_extracted");
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

  assert.equal(first[0].contentHash, second[0].contentHash);
  assert.equal(first[0].id, second[0].id);
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `rag-tokenizer.ts` and `rag-chunker.ts` do not exist.

- [ ] **Step 5: Implement token counter**

Create `apps/web/src/lib/rag-tokenizer.ts`:

```ts
import { getEncoding } from "js-tiktoken";

export type TokenCounter = {
  count(text: string): number;
  kind: "heuristic" | "tiktoken";
};

export function getTokenCounter(): TokenCounter {
  if (process.env.AV_OKF_BACKEND === "production") {
    return createTiktokenTokenCounter();
  }

  return createHeuristicTokenCounter();
}

export function createHeuristicTokenCounter(): TokenCounter {
  return {
    kind: "heuristic",
    count(text) {
      return Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.35));
    },
  };
}

export function createTiktokenTokenCounter(): TokenCounter {
  const encoding = getEncoding("cl100k_base");

  return {
    kind: "tiktoken",
    count(text) {
      return encoding.encode(text).length;
    },
  };
}
```

- [ ] **Step 6: Implement chunker**

Create `apps/web/src/lib/rag-chunker.ts`:

```ts
import { createHash } from "node:crypto";

import { getTokenCounter, type TokenCounter } from "./rag-tokenizer.ts";
import type { RagChunkInput, RagChunkRecord } from "./rag-types.ts";

const TARGET_TOKENS = 800;
const MAX_TOKENS = 1200;
const OVERLAP_TOKENS = 120;

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
  let buffer: typeof pageUnits = [];
  let bufferTokens = 0;

  for (const unit of pageUnits) {
    if (buffer.length > 0 && bufferTokens + unit.tokenCount > TARGET_TOKENS) {
      chunks.push(createChunk(input, chunks.length, buffer, tokenCounter));
      buffer = createOverlapBuffer(buffer);
      bufferTokens = buffer.reduce((sum, page) => sum + page.tokenCount, 0);
    }

    buffer.push(unit);
    bufferTokens += unit.tokenCount;

    if (bufferTokens >= MAX_TOKENS) {
      chunks.push(createChunk(input, chunks.length, buffer, tokenCounter));
      buffer = createOverlapBuffer(buffer);
      bufferTokens = buffer.reduce((sum, page) => sum + page.tokenCount, 0);
    }
  }

  if (buffer.length > 0) {
    chunks.push(createChunk(input, chunks.length, buffer, tokenCounter));
  }

  return chunks;
}

function createChunk(
  input: RagChunkInput,
  ordinal: number,
  pages: Array<{ pageNumber: number; text: string; tokenCount: number }>,
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

function createOverlapBuffer(
  pages: Array<{ pageNumber: number; text: string; tokenCount: number }>,
) {
  const overlap: typeof pages = [];
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
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/lib/rag-tokenizer.ts apps/web/src/lib/rag-tokenizer.test.mts apps/web/src/lib/rag-chunker.ts apps/web/src/lib/rag-chunker.test.mts
git commit -m "Add page-aware RAG chunker"
```

## Task 3: Add Embedding Provider Interface And Deterministic Provider

**Files:**

- Create: `apps/web/src/lib/embedding-provider.ts`
- Create: `apps/web/src/lib/embedding-provider.test.mts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/pnpm-lock.yaml`

- [ ] **Step 1: Install OpenAI SDK**

Run:

```bash
pnpm --dir apps/web add openai
```

Expected: `openai` appears in `apps/web/package.json`.

- [ ] **Step 2: Write provider tests**

Create `apps/web/src/lib/embedding-provider.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeterministicEmbeddingProvider,
  getEmbeddingProvider,
} from "./embedding-provider.ts";

test("deterministic embedding provider returns stable vectors", async () => {
  const provider = createDeterministicEmbeddingProvider();
  const first = await provider.embedTexts(["generator control unit"]);
  const second = await provider.embedTexts(["generator control unit"]);

  assert.equal(provider.model, "deterministic-test-embedding");
  assert.equal(provider.dimensions, 1536);
  assert.deepEqual(first, second);
  assert.equal(first[0].length, 1536);
});

test("getEmbeddingProvider uses deterministic provider outside production", () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AV_OKF_BACKEND = "local";

  const provider = getEmbeddingProvider();

  assert.equal(provider.model, "deterministic-test-embedding");
  process.env.AV_OKF_BACKEND = originalBackend;
  process.env.OPENAI_API_KEY = originalKey;
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `embedding-provider.ts` does not exist.

- [ ] **Step 4: Implement provider**

Create `apps/web/src/lib/embedding-provider.ts`:

```ts
import { createHash } from "node:crypto";

export type EmbeddingProvider = {
  dimensions: number;
  embedTexts(input: string[]): Promise<number[][]>;
  model: string;
};

export function getEmbeddingProvider(): EmbeddingProvider {
  if (process.env.AV_OKF_BACKEND === "production") {
    return createOpenAiEmbeddingProvider();
  }

  return createDeterministicEmbeddingProvider();
}

export function createDeterministicEmbeddingProvider(
  dimensions = 1536,
): EmbeddingProvider {
  return {
    dimensions,
    model: "deterministic-test-embedding",
    async embedTexts(input) {
      return input.map((text) => deterministicVector(text, dimensions));
    },
  };
}

export function createOpenAiEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("missing_env_OPENAI_API_KEY");
  }

  return {
    dimensions: 1536,
    model: "text-embedding-3-small",
    async embedTexts(input) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const response = await client.embeddings.create({
        encoding_format: "float",
        input,
        model: "text-embedding-3-small",
      });

      return response.data
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
    },
  };
}

function deterministicVector(text: string, dimensions: number) {
  const values: number[] = [];
  let counter = 0;

  while (values.length < dimensions) {
    const digest = createHash("sha256")
      .update(`${text}:${counter}`)
      .digest();

    for (const byte of digest) {
      values.push(byte / 127.5 - 1);

      if (values.length === dimensions) {
        break;
      }
    }

    counter += 1;
  }

  return normalize(values);
}

function normalize(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass without `OPENAI_API_KEY`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/lib/embedding-provider.ts apps/web/src/lib/embedding-provider.test.mts
git commit -m "Add embedding provider abstraction"
```

## Task 4: Add Embedding Budget Checks

**Files:**

- Create: `apps/web/src/lib/rag-budget.ts`
- Create: `apps/web/src/lib/rag-budget.test.mts`

- [ ] **Step 1: Write budget tests**

Create `apps/web/src/lib/rag-budget.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { assertEmbeddingBudget } from "./rag-budget.ts";

test("assertEmbeddingBudget fails before provider call when document cap is exceeded", () => {
  assert.throws(
    () =>
      assertEmbeddingBudget({
        documentTokenEstimate: 250001,
        globalTokensUsedToday: 0,
        workspaceTokensUsedToday: 0,
      }),
    /embedding_budget_exceeded/,
  );
});

test("assertEmbeddingBudget fails when workspace daily cap would be exceeded", () => {
  assert.throws(
    () =>
      assertEmbeddingBudget({
        documentTokenEstimate: 90000,
        globalTokensUsedToday: 0,
        workspaceTokensUsedToday: 940000,
      }),
    /Workspace has 940000 tokens indexed today/,
  );
});

test("assertEmbeddingBudget allows requests under all caps", () => {
  assert.doesNotThrow(() =>
    assertEmbeddingBudget({
      documentTokenEstimate: 1000,
      globalTokensUsedToday: 2000,
      workspaceTokensUsedToday: 3000,
    }),
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `rag-budget.ts` does not exist.

- [ ] **Step 3: Implement budget checks**

Create `apps/web/src/lib/rag-budget.ts`:

```ts
export class EmbeddingBudgetExceededError extends Error {
  code = "embedding_budget_exceeded" as const;

  constructor(message: string) {
    super(`embedding_budget_exceeded: ${message}`);
    this.name = "EmbeddingBudgetExceededError";
  }
}

export type EmbeddingBudgetInput = {
  documentTokenEstimate: number;
  globalTokensUsedToday: number;
  workspaceTokensUsedToday: number;
};

export type EmbeddingBudgetCaps = {
  globalTokensPerDay: number;
  tokensPerDocument: number;
  workspaceTokensPerDay: number;
};

export function getEmbeddingBudgetCaps(): EmbeddingBudgetCaps {
  return {
    globalTokensPerDay: numberEnv("RAG_EMBEDDING_MAX_TOKENS_GLOBAL_DAY", 5_000_000),
    tokensPerDocument: numberEnv("RAG_EMBEDDING_MAX_TOKENS_PER_DOCUMENT", 250_000),
    workspaceTokensPerDay: numberEnv(
      "RAG_EMBEDDING_MAX_TOKENS_PER_WORKSPACE_DAY",
      1_000_000,
    ),
  };
}

export function assertEmbeddingBudget(
  input: EmbeddingBudgetInput,
  caps = getEmbeddingBudgetCaps(),
): void {
  if (input.documentTokenEstimate > caps.tokensPerDocument) {
    throw new EmbeddingBudgetExceededError(
      `Document requires ${input.documentTokenEstimate} embedding tokens, exceeding per-document cap of ${caps.tokensPerDocument}.`,
    );
  }

  if (
    input.workspaceTokensUsedToday + input.documentTokenEstimate >
    caps.workspaceTokensPerDay
  ) {
    throw new EmbeddingBudgetExceededError(
      `Workspace has ${input.workspaceTokensUsedToday} tokens indexed today; this job requires ${input.documentTokenEstimate} and would exceed daily cap of ${caps.workspaceTokensPerDay}.`,
    );
  }

  if (input.globalTokensUsedToday + input.documentTokenEstimate > caps.globalTokensPerDay) {
    throw new EmbeddingBudgetExceededError("Global daily embedding cap exceeded.");
  }
}

function numberEnv(key: string, fallback: number) {
  const value = process.env[key];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid_env_${key}`);
  }

  return parsed;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/rag-budget.ts apps/web/src/lib/rag-budget.test.mts
git commit -m "Add RAG embedding budget checks"
```

## Task 5: Add pgvector Schema And Compose Support

**Files:**

- Modify: `apps/web/prisma/schema.prisma`
- Create: `apps/web/prisma/migrations/20260701110000_stage_4_rag_search/migration.sql`
- Modify: `docker-compose.yml`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Modify Prisma schema**

Add the models from the Data Model section to `apps/web/prisma/schema.prisma`.

- [ ] **Step 2: Add SQL migration**

Create `apps/web/prisma/migrations/20260701110000_stage_4_rag_search/migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Document"
  ADD COLUMN "ragStatus" TEXT NOT NULL DEFAULT 'not_indexed',
  ADD COLUMN "ragIndexVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RagIndexJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "extractionJobId" TEXT,
  "status" TEXT NOT NULL,
  "indexVersion" INTEGER NOT NULL,
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RagIndexJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RagChunk" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "indexJobId" TEXT NOT NULL,
  "indexVersion" INTEGER NOT NULL,
  "chunkOrdinal" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "pageStart" INTEGER NOT NULL,
  "pageEnd" INTEGER NOT NULL,
  "sourcePageNumbers" INTEGER[],
  "headingPath" TEXT[],
  "reviewStatus" TEXT NOT NULL DEFAULT 'raw_extracted',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RagEmbedding" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RagEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OkfConceptChunkLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "okfConceptId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "coverageType" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'okf_frontmatter',
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OkfConceptChunkLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RagChunk_documentId_indexVersion_chunkOrdinal_key"
  ON "RagChunk"("documentId", "indexVersion", "chunkOrdinal");
CREATE UNIQUE INDEX "RagEmbedding_chunkId_key" ON "RagEmbedding"("chunkId");
CREATE UNIQUE INDEX "OkfConceptChunkLink_workspaceId_okfConceptId_chunkId_key"
  ON "OkfConceptChunkLink"("workspaceId", "okfConceptId", "chunkId");

CREATE INDEX "RagIndexJob_status_queuedAt_idx" ON "RagIndexJob"("status", "queuedAt");
CREATE INDEX "RagIndexJob_workspaceId_documentId_status_idx"
  ON "RagIndexJob"("workspaceId", "documentId", "status");
CREATE INDEX "RagChunk_workspaceId_documentId_isActive_idx"
  ON "RagChunk"("workspaceId", "documentId", "isActive");
CREATE INDEX "RagChunk_workspaceId_isActive_idx" ON "RagChunk"("workspaceId", "isActive");
CREATE INDEX "RagChunk_contentHash_idx" ON "RagChunk"("contentHash");
CREATE INDEX "RagEmbedding_workspaceId_model_idx" ON "RagEmbedding"("workspaceId", "model");
CREATE INDEX "OkfConceptChunkLink_workspaceId_chunkId_idx"
  ON "OkfConceptChunkLink"("workspaceId", "chunkId");

ALTER TABLE "RagIndexJob"
  ADD CONSTRAINT "RagIndexJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RagIndexJob"
  ADD CONSTRAINT "RagIndexJob_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RagChunk"
  ADD CONSTRAINT "RagChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RagChunk"
  ADD CONSTRAINT "RagChunk_indexJobId_fkey"
  FOREIGN KEY ("indexJobId") REFERENCES "RagIndexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RagEmbedding"
  ADD CONSTRAINT "RagEmbedding_chunkId_fkey"
  FOREIGN KEY ("chunkId") REFERENCES "RagChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Switch Compose Postgres image to pgvector**

In `docker-compose.yml`, change:

```yaml
image: postgres:17-alpine
```

to:

```yaml
image: pgvector/pgvector:pg17
```

- [ ] **Step 4: Add env vars**

Add to `apps/web/.env.example`:

```text
OPENAI_API_KEY=
RAG_EMBEDDING_MAX_TOKENS_PER_DOCUMENT=250000
RAG_EMBEDDING_MAX_TOKENS_PER_WORKSPACE_DAY=1000000
RAG_EMBEDDING_MAX_TOKENS_GLOBAL_DAY=5000000
```

- [ ] **Step 5: Generate Prisma client and build**

Run:

```bash
pnpm --dir apps/web db:generate
pnpm --dir apps/web build
```

Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations/20260701110000_stage_4_rag_search/migration.sql docker-compose.yml apps/web/.env.example
git commit -m "Add RAG pgvector schema"
```

## Task 6: Add RAG Repository

**Files:**

- Create: `apps/web/src/lib/rag-repository.ts`
- Create: `apps/web/src/lib/rag-repository.test.mts`

- [ ] **Step 1: Write repository unit tests with fake client**

Create `apps/web/src/lib/rag-repository.test.mts`:

```ts
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
        return { id: "job_1", documentId: "doc_1", indexVersion: data.indexVersion, workspaceId: "wrk_1" };
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `rag-repository.ts` does not exist.

- [ ] **Step 3: Implement repository**

Create `apps/web/src/lib/rag-repository.ts` with methods:

```ts
import { getPrisma } from "./prisma.ts";
import type { RagChunkRecord, RetrievalResult } from "./rag-types.ts";

type PrismaLike = ReturnType<typeof getPrisma>;

export type RagRepository = ReturnType<typeof createRagRepository>;

export function createRagRepository(prisma: PrismaLike = getPrisma()) {
  const db = prisma;

  return {
    async createIndexJob(input: {
      documentId: string;
      extractionJobId?: string;
      workspaceId: string;
    }) {
      const document = await db.document.findFirst({
        select: { ragIndexVersion: true },
        where: { id: input.documentId, workspaceId: input.workspaceId },
      });

      if (!document) {
        throw new Error("document_not_found");
      }

      const indexVersion = document.ragIndexVersion + 1;
      const job = await db.ragIndexJob.create({
        data: {
          documentId: input.documentId,
          extractionJobId: input.extractionJobId,
          indexVersion,
          status: "queued",
          workspaceId: input.workspaceId,
        },
      });

      await db.document.update({
        data: { ragStatus: "queued" },
        where: { id: input.documentId },
      });

      return job;
    },
    async getExtractedPages(input: { documentId: string; workspaceId: string }) {
      return db.extractedPage.findMany({
        orderBy: { pageNumber: "asc" },
        where: { documentId: input.documentId, workspaceId: input.workspaceId },
      });
    },
    async getTokenUsageToday(input: { workspaceId: string }) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const [workspace, global] = await Promise.all([
        db.ragIndexJob.aggregate({
          _sum: { tokenEstimate: true },
          where: {
            completedAt: { gte: start },
            status: "completed",
            workspaceId: input.workspaceId,
          },
        }),
        db.ragIndexJob.aggregate({
          _sum: { tokenEstimate: true },
          where: {
            completedAt: { gte: start },
            status: "completed",
          },
        }),
      ]);

      return {
        globalTokensUsedToday: global._sum.tokenEstimate ?? 0,
        workspaceTokensUsedToday: workspace._sum.tokenEstimate ?? 0,
      };
    },
    async markIndexJobRunning(input: { indexJobId: string; tokenEstimate: number }) {
      await db.ragIndexJob.update({
        data: {
          attempts: { increment: 1 },
          startedAt: new Date(),
          status: "running",
          tokenEstimate: input.tokenEstimate,
        },
        where: { id: input.indexJobId },
      });
    },
    async failIndexJob(input: {
      documentId: string;
      errorCode: string;
      errorMessage: string;
      indexJobId: string;
    }) {
      await db.ragIndexJob.update({
        data: {
          completedAt: new Date(),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          status: "failed",
        },
        where: { id: input.indexJobId },
      });
      await db.document.update({
        data: { ragStatus: "index_failed" },
        where: { id: input.documentId },
      });
    },
    async storeCompletedIndex(input: {
      chunks: RagChunkRecord[];
      documentId: string;
      embeddings: number[][];
      indexJobId: string;
      indexVersion: number;
      model: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx) => {
        await tx.ragChunk.updateMany({
          data: { isActive: false },
          where: { documentId: input.documentId, workspaceId: input.workspaceId },
        });

        for (let index = 0; index < input.chunks.length; index += 1) {
          const chunk = input.chunks[index];
          await tx.ragChunk.create({
            data: {
              ...chunk,
              isActive: true,
              embedding: {
                create: {
                  dimensions: input.embeddings[index].length,
                  embedding: input.embeddings[index],
                  model: input.model,
                  tokenCount: chunk.tokenCount,
                  workspaceId: input.workspaceId,
                },
              },
            },
          });
        }

        await tx.ragIndexJob.update({
          data: { completedAt: new Date(), status: "completed" },
          where: { id: input.indexJobId },
        });
        await tx.document.update({
          data: {
            ragIndexVersion: input.indexVersion,
            ragStatus: "indexed",
          },
          where: { id: input.documentId },
        });
      });
    },
    async getQueuedIndexJobs(limit = 100) {
      return db.ragIndexJob.findMany({
        orderBy: { queuedAt: "asc" },
        take: limit,
        where: { status: { in: ["queued", "running"] } },
      });
    },
    async searchKeyword(input: {
      query: string;
      topK: number;
      workspaceId: string;
    }): Promise<RetrievalResult[]> {
      const rows = await db.ragChunk.findMany({
        include: { document: true },
        take: input.topK,
        where: {
          isActive: true,
          text: { contains: input.query, mode: "insensitive" },
          workspaceId: input.workspaceId,
        },
      });

      return rows.map((row, index) => ({
        chunkId: row.id,
        coveredByOkfConceptIds: [],
        documentId: row.documentId,
        documentTitle: row.document.title,
        pageEnd: row.pageEnd,
        pageStart: row.pageStart,
        retrievalMode: "keyword",
        score: 1 / (index + 1),
        sourcePageNumbers: row.sourcePageNumbers,
        text: row.text,
      }));
    },
  };
}
```

Implement vector writes in `storeCompletedIndex` with `tx.$executeRaw` so pgvector receives a typed vector literal:

```ts
await tx.$executeRaw`
  INSERT INTO "RagEmbedding" (
    "id",
    "workspaceId",
    "chunkId",
    "model",
    "dimensions",
    "tokenCount",
    "embedding",
    "createdAt"
  )
  VALUES (
    ${crypto.randomUUID()},
    ${input.workspaceId},
    ${chunk.id},
    ${input.model},
    ${input.embeddings[index].length},
    ${chunk.tokenCount},
    ${`[${input.embeddings[index].join(",")}]`}::vector,
    NOW()
  )
`;
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/rag-repository.ts apps/web/src/lib/rag-repository.test.mts
git commit -m "Add RAG repository"
```

## Task 7: Add RAG Queue

**Files:**

- Create: `apps/web/src/lib/rag-queue.ts`
- Create: `apps/web/src/lib/rag-queue.test.mts`

- [ ] **Step 1: Write queue tests**

Create `apps/web/src/lib/rag-queue.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { buildRagIndexJobId } from "./rag-queue.ts";

test("buildRagIndexJobId is deterministic", () => {
  assert.equal(
    buildRagIndexJobId({ documentId: "doc_1", indexJobId: "job_1" }),
    "rag-index:doc_1:job_1",
  );
});

test("buildRagIndexJobId rejects unsafe segments", () => {
  assert.throws(
    () => buildRagIndexJobId({ documentId: "doc:1", indexJobId: "job_1" }),
    /unsafe_queue_id_segment/,
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `rag-queue.ts` does not exist.

- [ ] **Step 3: Implement RAG queue**

Create `apps/web/src/lib/rag-queue.ts`:

```ts
import { Queue } from "bullmq";

export type RagIndexJobPayload = {
  documentId: string;
  indexVersion: number;
  indexJobId: string;
  workspaceId: string;
};

export type RagIndexQueue = {
  enqueueIndexJob(payload: RagIndexJobPayload): Promise<void>;
};

let cachedQueue: RagIndexQueue | null = null;

export function buildRagIndexJobId(input: {
  documentId: string;
  indexJobId: string;
}) {
  assertSafeQueueSegment(input.documentId);
  assertSafeQueueSegment(input.indexJobId);
  return `rag-index:${input.documentId}:${input.indexJobId}`;
}

export function createBullMqRagIndexQueue(redisUrl = requiredEnv("REDIS_URL")): RagIndexQueue {
  const queue = new Queue<RagIndexJobPayload>("rag-index", {
    connection: { url: redisUrl },
  });

  return {
    async enqueueIndexJob(payload) {
      await queue.add("index", payload, {
        attempts: 3,
        backoff: { delay: 5_000, type: "exponential" },
        jobId: buildRagIndexJobId(payload),
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
  };
}

export function getRagIndexQueue() {
  if (!cachedQueue) {
    cachedQueue = createBullMqRagIndexQueue();
  }

  return cachedQueue;
}

function assertSafeQueueSegment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("unsafe_queue_id_segment");
  }
}

function requiredEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`missing_env_${key}`);
  }

  return value;
}
```

Budget failures are excluded from these retries by `runRagIndexJob`, which throws BullMQ `UnrecoverableError` only for `EmbeddingBudgetExceededError`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/rag-queue.ts apps/web/src/lib/rag-queue.test.mts
git commit -m "Add RAG indexing queue"
```

## Task 8: Add RAG Indexer

**Files:**

- Create: `apps/web/src/lib/rag-indexer.ts`
- Create: `apps/web/src/lib/rag-indexer.test.mts`

- [ ] **Step 1: Write indexer tests**

Create `apps/web/src/lib/rag-indexer.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { UnrecoverableError } from "bullmq";

import { runRagIndexJob } from "./rag-indexer.ts";

test("runRagIndexJob checks budget before embedding provider call", async () => {
  let providerCalled = false;
  let failureCode = "";

  await assert.rejects(
    () =>
      runRagIndexJob(
        { documentId: "doc_1", indexJobId: "job_1", indexVersion: 1, workspaceId: "wrk_1" },
        {
          budgetCaps: {
            globalTokensPerDay: 100,
            tokensPerDocument: 10,
            workspaceTokensPerDay: 100,
          },
          chunkPages: () => [
            {
              chunkOrdinal: 0,
              contentHash: "hash",
              documentId: "doc_1",
              headingPath: [],
              id: "rag_doc_1_1_0_hash",
              indexJobId: "job_1",
              indexVersion: 1,
              pageEnd: 1,
              pageStart: 1,
              reviewStatus: "raw_extracted",
              sourcePageNumbers: [1],
              text: "too many tokens",
              tokenCount: 11,
              workspaceId: "wrk_1",
            },
          ],
          embeddingProvider: {
            dimensions: 1536,
            model: "test",
            async embedTexts() {
              providerCalled = true;
              return [];
            },
          },
          repository: {
            failIndexJob: async (input: { errorCode: string }) => {
              failureCode = input.errorCode;
            },
            getExtractedPages: async () => [],
            getTokenUsageToday: async () => ({
              globalTokensUsedToday: 0,
              workspaceTokensUsedToday: 0,
            }),
            markIndexJobRunning: async () => {},
            storeCompletedIndex: async () => {},
          },
        },
      ),
    (error) =>
      error instanceof UnrecoverableError &&
      /embedding_budget_exceeded/.test(error.message),
  );

  assert.equal(providerCalled, false);
  assert.equal(failureCode, "embedding_budget_exceeded");
});

test("runRagIndexJob stores completed index when embedding succeeds", async () => {
  let storedChunks = 0;

  await runRagIndexJob(
    { documentId: "doc_1", indexJobId: "job_1", indexVersion: 1, workspaceId: "wrk_1" },
    {
      chunkPages: () => [
        {
          chunkOrdinal: 0,
          contentHash: "hash",
          documentId: "doc_1",
          headingPath: [],
          id: "rag_doc_1_1_0_hash",
          indexJobId: "job_1",
          indexVersion: 1,
          pageEnd: 1,
          pageStart: 1,
          reviewStatus: "raw_extracted",
          sourcePageNumbers: [1],
          text: "generator control",
          tokenCount: 2,
          workspaceId: "wrk_1",
        },
      ],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
          return input.map(() => Array.from({ length: 1536 }, () => 0.01));
        },
      },
      repository: {
        failIndexJob: async () => {},
        getExtractedPages: async () => [],
        getTokenUsageToday: async () => ({
          globalTokensUsedToday: 0,
          workspaceTokensUsedToday: 0,
        }),
        markIndexJobRunning: async () => {},
        storeCompletedIndex: async (input: { chunks: unknown[] }) => {
          storedChunks = input.chunks.length;
        },
      },
    },
  );

  assert.equal(storedChunks, 1);
});

test("runRagIndexJob rethrows transient provider failures for BullMQ retry", async () => {
  let failureCode = "";

  await assert.rejects(
    () =>
      runRagIndexJob(
        { documentId: "doc_1", indexJobId: "job_1", indexVersion: 1, workspaceId: "wrk_1" },
        {
          chunkPages: () => [
            {
              chunkOrdinal: 0,
              contentHash: "hash",
              documentId: "doc_1",
              headingPath: [],
              id: "rag_doc_1_1_0_hash",
              indexJobId: "job_1",
              indexVersion: 1,
              pageEnd: 1,
              pageStart: 1,
              reviewStatus: "raw_extracted",
              sourcePageNumbers: [1],
              text: "generator control",
              tokenCount: 2,
              workspaceId: "wrk_1",
            },
          ],
          embeddingProvider: {
            dimensions: 1536,
            model: "test",
            async embedTexts() {
              throw new Error("provider timeout");
            },
          },
          repository: {
            failIndexJob: async (input: { errorCode: string }) => {
              failureCode = input.errorCode;
            },
            getExtractedPages: async () => [],
            getTokenUsageToday: async () => ({
              globalTokensUsedToday: 0,
              workspaceTokensUsedToday: 0,
            }),
            markIndexJobRunning: async () => {},
            storeCompletedIndex: async () => {},
          },
        },
      ),
    /provider timeout/,
  );

  assert.equal(failureCode, "indexing_failed");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/web test
```

Expected: fails because `rag-indexer.ts` does not exist.

- [ ] **Step 3: Implement indexer**

Create `apps/web/src/lib/rag-indexer.ts`:

```ts
import { UnrecoverableError } from "bullmq";

import {
  EmbeddingBudgetExceededError,
  assertEmbeddingBudget,
  type EmbeddingBudgetCaps,
} from "./rag-budget.ts";
import { chunkExtractedPages } from "./rag-chunker.ts";
import { getEmbeddingProvider, type EmbeddingProvider } from "./embedding-provider.ts";
import { createRagRepository, type RagRepository } from "./rag-repository.ts";
import type { RagIndexJobPayload } from "./rag-queue.ts";
import type { ExtractedPageRecord } from "./document-vault.ts";
import type { RagChunkInput, RagChunkRecord } from "./rag-types.ts";

type RunRagIndexJobOptions = {
  budgetCaps?: EmbeddingBudgetCaps;
  chunkPages?: (input: RagChunkInput) => RagChunkRecord[];
  embeddingProvider?: EmbeddingProvider;
  repository?: Pick<
    RagRepository,
    | "failIndexJob"
    | "getExtractedPages"
    | "getTokenUsageToday"
    | "markIndexJobRunning"
    | "storeCompletedIndex"
  >;
};

export async function runRagIndexJob(
  payload: RagIndexJobPayload,
  options: RunRagIndexJobOptions = {},
) {
  const repository = options.repository ?? createRagRepository();
  const embeddingProvider = options.embeddingProvider ?? getEmbeddingProvider();
  const chunkPages = options.chunkPages ?? chunkExtractedPages;

  try {
    const pages = (await repository.getExtractedPages(payload)) as ExtractedPageRecord[];
    const chunks = chunkPages({
      documentId: payload.documentId,
      indexJobId: payload.indexJobId,
      indexVersion: payload.indexVersion,
      pages,
      workspaceId: payload.workspaceId,
    });
    const tokenEstimate = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    const usage = await repository.getTokenUsageToday({
      workspaceId: payload.workspaceId,
    });

    assertEmbeddingBudget(
      {
        documentTokenEstimate: tokenEstimate,
        globalTokensUsedToday: usage.globalTokensUsedToday,
        workspaceTokensUsedToday: usage.workspaceTokensUsedToday,
      },
      options.budgetCaps,
    );

    await repository.markIndexJobRunning({
      indexJobId: payload.indexJobId,
      tokenEstimate,
    });

    const embeddings = await embeddingProvider.embedTexts(
      chunks.map((chunk) => chunk.text),
    );

    await repository.storeCompletedIndex({
      chunks,
      documentId: payload.documentId,
      embeddings,
      indexJobId: payload.indexJobId,
      indexVersion: payload.indexVersion,
      model: embeddingProvider.model,
      workspaceId: payload.workspaceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isBudgetFailure = error instanceof EmbeddingBudgetExceededError;
    await repository.failIndexJob({
      documentId: payload.documentId,
      errorCode: isBudgetFailure
        ? "embedding_budget_exceeded"
        : "indexing_failed",
      errorMessage: message,
      indexJobId: payload.indexJobId,
    });

    if (isBudgetFailure) {
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/rag-indexer.ts apps/web/src/lib/rag-indexer.test.mts
git commit -m "Add RAG indexing job runner"
```

## Task 9: Wire Extraction Completion To RAG Indexing

**Files:**

- Modify: `apps/web/src/lib/production-worker.ts`
- Modify: `apps/web/src/worker/extraction-worker.ts`
- Modify: `apps/web/src/lib/production-repository.ts`

- [ ] **Step 1: Add repository method to create RAG index job**

In `apps/web/src/lib/production-repository.ts`, expose a method:

```ts
async createRagIndexJobAfterExtraction(input: {
  documentId: string;
  extractionJobId: string;
  workspaceId: string;
}) {
  const { createRagRepository } = await import("./rag-repository.ts");
  return createRagRepository().createIndexJob(input);
}
```

- [ ] **Step 2: Update production worker options**

In `apps/web/src/lib/production-worker.ts`, extend options:

```ts
type RunProductionExtractionJobOptions = {
  extractPdfPages?: (bytes: Buffer) => Promise<ExtractedPageRecord[]>;
  ragQueue?: {
    enqueueIndexJob(input: {
      documentId: string;
      indexJobId: string;
      indexVersion: number;
      workspaceId: string;
    }): Promise<void>;
  };
  repository: ProductionExtractionRepository & {
    createRagIndexJobAfterExtraction?(input: {
      documentId: string;
      extractionJobId: string;
      workspaceId: string;
    }): Promise<{ id: string; documentId: string; indexVersion: number; workspaceId: string }>;
  };
  storage: Pick<ObjectStorage, "getObject">;
};
```

After `completeExtractionJob`, add:

```ts
if (options.ragQueue && options.repository.createRagIndexJobAfterExtraction) {
  const indexJob = await options.repository.createRagIndexJobAfterExtraction(payload);
  await options.ragQueue.enqueueIndexJob({
    documentId: indexJob.documentId,
    indexJobId: indexJob.id,
    indexVersion: indexJob.indexVersion,
    workspaceId: indexJob.workspaceId,
  });
}
```

- [ ] **Step 3: Update worker process**

In `apps/web/src/worker/extraction-worker.ts`, import:

```ts
import { Worker } from "bullmq";
import { createBullMqRagIndexQueue, type RagIndexJobPayload } from "../lib/rag-queue.ts";
import { runRagIndexJob } from "../lib/rag-indexer.ts";
```

Create both queues:

```ts
const ragQueue = createBullMqRagIndexQueue(redisUrl);
```

Pass `ragQueue` into extraction:

```ts
await runProductionExtractionJob(job.data, {
  ragQueue,
  repository,
  storage,
});
```

Start a second worker:

```ts
const ragWorker = new Worker<RagIndexJobPayload>(
  "rag-index",
  async (job) => {
    await runRagIndexJob(job.data);
  },
  {
    concurrency: Number(process.env.RAG_INDEX_WORKER_CONCURRENCY ?? "1"),
    connection: { url: redisUrl },
  },
);
```

Close both workers in shutdown.

- [ ] **Step 4: Run tests and build**

Run:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/production-worker.ts apps/web/src/worker/extraction-worker.ts apps/web/src/lib/production-repository.ts
git commit -m "Queue RAG indexing after extraction"
```

## Task 10: Add Retrieval Service And Facade

**Files:**

- Create: `apps/web/src/lib/rag-retrieval.ts`
- Create: `apps/web/src/lib/rag-retrieval.test.mts`
- Create: `apps/web/src/lib/rag-backend.ts`

- [ ] **Step 1: Write retrieval tests**

Create `apps/web/src/lib/rag-retrieval.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { reciprocalRankFusion } from "./rag-retrieval.ts";

test("reciprocalRankFusion merges vector and keyword rankings deterministically", () => {
  const results = reciprocalRankFusion([
    [
      { chunkId: "a", score: 1 },
      { chunkId: "b", score: 0.5 },
    ],
    [
      { chunkId: "b", score: 1 },
      { chunkId: "c", score: 0.5 },
    ],
  ]);

  assert.deepEqual(
    results.map((result) => result.chunkId),
    ["b", "a", "c"],
  );
});
```

- [ ] **Step 2: Implement retrieval helpers**

Create `apps/web/src/lib/rag-retrieval.ts`:

```ts
export type RankedChunk = {
  chunkId: string;
  score: number;
};

export function reciprocalRankFusion(rankings: RankedChunk[][], k = 60): RankedChunk[] {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (k + index + 1));
    });
  }

  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
}
```

- [ ] **Step 3: Add backend facade**

Create `apps/web/src/lib/rag-backend.ts`:

```ts
import { getEmbeddingProvider } from "./embedding-provider.ts";
import { createRagRepository } from "./rag-repository.ts";
import type { RetrievalRequest, RetrievalResult } from "./rag-types.ts";

export async function retrieveDocuments(
  request: RetrievalRequest,
): Promise<RetrievalResult[]> {
  const repository = createRagRepository();

  if (request.mode === "keyword") {
    return repository.searchKeyword(request);
  }

  const provider = getEmbeddingProvider();
  const [queryEmbedding] = await provider.embedTexts([request.query]);

  if (request.mode === "vector") {
    return searchVector(repository, request, queryEmbedding);
  }

  const [keywordResults, vectorResults] = await Promise.all([
    repository.searchKeyword(request),
    searchVector(repository, request, queryEmbedding),
  ]);

  return mergeHybridResults(keywordResults, vectorResults, request.topK);
}

async function searchVector(
  repository: ReturnType<typeof createRagRepository>,
  request: RetrievalRequest,
  embedding: number[],
) {
  if ("searchVector" in repository && typeof repository.searchVector === "function") {
    return repository.searchVector({ ...request, embedding });
  }

  return [];
}

function mergeHybridResults(
  keywordResults: RetrievalResult[],
  vectorResults: RetrievalResult[],
  topK: number,
) {
  const byChunk = new Map<string, RetrievalResult>();

  for (const result of [...keywordResults, ...vectorResults]) {
    const existing = byChunk.get(result.chunkId);
    byChunk.set(result.chunkId, existing && existing.score > result.score ? existing : result);
  }

  return [...byChunk.values()]
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
    .slice(0, topK)
    .map((result) => ({ ...result, retrievalMode: "hybrid" as const }));
}
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/rag-retrieval.ts apps/web/src/lib/rag-retrieval.test.mts apps/web/src/lib/rag-backend.ts
git commit -m "Add RAG retrieval facade"
```

## Task 11: Add Minimal Search UI

**Files:**

- Create: `apps/web/src/app/(app)/search/page.tsx`
- Create: `apps/web/src/components/search-form.tsx`
- Create: `apps/web/src/components/search-results.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: Add server-rendered search page**

Create `apps/web/src/app/(app)/search/page.tsx`:

```tsx
import { SearchForm } from "@/components/search-form";
import { SearchResults } from "@/components/search-results";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { retrieveDocuments } from "@/lib/rag-backend";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const context = await requireAuthWorkspaceContext();
  const query = params.q?.trim() ?? "";
  const results =
    query.length > 0
      ? await retrieveDocuments({
          mode: "hybrid",
          query,
          topK: 10,
          workspaceId: context.workspaceId,
        })
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Search extracted document chunks with page-level citations.
        </p>
      </div>
      <SearchForm query={query} />
      <SearchResults query={query} results={results} />
    </div>
  );
}
```

- [ ] **Step 2: Add search form**

Create `apps/web/src/components/search-form.tsx`:

```tsx
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchForm({ query }: { query: string }) {
  return (
    <form className="flex gap-2" action="/search">
      <Input name="q" defaultValue={query} placeholder="Search documents" />
      <Button type="submit">
        <Search className="h-4 w-4" />
        Search
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Add results component**

Create `apps/web/src/components/search-results.tsx`:

```tsx
import type { RetrievalResult } from "@/lib/rag-types";

export function SearchResults({
  query,
  results,
}: {
  query: string;
  results: RetrievalResult[];
}) {
  if (!query) {
    return <p className="text-sm text-muted-foreground">Enter a query to search indexed document chunks.</p>;
  }

  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">No indexed chunks matched this query.</p>;
  }

  return (
    <div className="space-y-3">
      {results.map((result) => (
        <article key={result.chunkId} className="rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{result.documentTitle}</h2>
            <span className="text-xs text-muted-foreground">
              Pages {result.pageStart}-{result.pageEnd}
            </span>
          </div>
          <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">
            {result.text}
          </p>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add sidebar nav item**

In `apps/web/src/components/app-shell.tsx`, add a Search nav item with a lucide `Search` icon.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm --dir apps/web build
```

Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(app)/search/page.tsx apps/web/src/components/search-form.tsx apps/web/src/components/search-results.tsx apps/web/src/components/app-shell.tsx
git commit -m "Add RAG search UI shell"
```

## Task 12: Add End-To-End RAG Pipeline Test

**Files:**

- Create: `apps/web/src/lib/rag-pipeline.test.mts`

- [ ] **Step 1: Write E2E pipeline test**

Create `apps/web/src/lib/rag-pipeline.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicEmbeddingProvider } from "./embedding-provider.ts";
import { extractPdfPages } from "./pdf-text-extractor.ts";
import { chunkExtractedPages } from "./rag-chunker.ts";

test("real PDF extraction can be chunked and embedded without API calls", async () => {
  const pdfBytes = Buffer.from(
    "%PDF-1.3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 72 >>\nstream\nBT /F1 14 Tf 40 240 Td (Generator Control Unit) Tj 0 -24 Td (Fault isolation procedure) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000363 00000 n \ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n433\n%%EOF",
  );
  const pages = await extractPdfPages(pdfBytes);
  const chunks = chunkExtractedPages({
    documentId: "doc_real",
    indexJobId: "job_real",
    indexVersion: 1,
    pages,
    workspaceId: "wrk_1",
  });
  const provider = createDeterministicEmbeddingProvider();
  const embeddings = await provider.embedTexts(chunks.map((chunk) => chunk.text));

  assert.equal(chunks.length > 0, true);
  assert.equal(embeddings.length, chunks.length);
  assert.equal(embeddings[0].length, 1536);
  assert.equal(chunks[0].sourcePageNumbers.includes(1), true);
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: all tests pass without `OPENAI_API_KEY`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/rag-pipeline.test.mts
git commit -m "Add RAG pipeline regression test"
```

## Task 13: Update Docs

**Files:**

- Modify: `README.md`
- Modify: `docs/roadmap/mvp-stages.md`

- [ ] **Step 1: Update README**

Add a Stage 4 section:

```markdown
### Stage 4 RAG Search

Stage 4 indexes extracted page records into retrieval-sized chunks. Production uses OpenAI `text-embedding-3-small` and Postgres + pgvector. Local tests use deterministic embeddings and never require an API key.

RAG chunks are independent from OKF topics. RAG chunks optimize retrieval; OKF topics optimize human-reviewed meaning.

Embedding budget caps are enforced before any OpenAI API call. If a cap is exceeded, indexing fails with `embedding_budget_exceeded`; the system does not truncate documents silently.
```

- [ ] **Step 2: Update roadmap**

In `docs/roadmap/mvp-stages.md`, under Stage 4 deliverables, add:

```markdown
- OpenAI `text-embedding-3-small` production embedding provider
- deterministic local/test embedding provider
- pre-call token budget enforcement
- Postgres + pgvector vector storage
- derived OKF-to-RAG coverage projection; OKF frontmatter remains the source of truth
```

- [ ] **Step 3: Run docs-neutral checks**

Run:

```bash
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/roadmap/mvp-stages.md
git commit -m "Document Stage 4 RAG search"
```

## Task 14: Final Verification

**Files:**

- No new files

- [ ] **Step 1: Run full regression**

Run:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
docker compose config
docker compose build
```

Expected:

- web tests pass
- lint passes
- Next build passes
- OKF relation lint returns `status: pass`
- Compose config renders
- Docker image builds

- [ ] **Step 2: Run production-mode smoke**

With OAuth credentials configured:

```bash
docker compose up -d
```

Manual smoke:

```text
1. Log in.
2. Upload real PDF.
3. Worker extracts pages.
4. RAG indexing job completes.
5. Search page returns chunks with source page numbers.
6. Restart web and worker.
7. Search still returns persisted chunks.
```

- [ ] **Step 3: Commit final verification note if docs changed**

If verification findings require doc updates:

```bash
git add README.md docs/roadmap/mvp-stages.md docs/deployment/vps-production.md
git commit -m "Update Stage 4 verification notes"
```

## Self-Review

Spec coverage:

- Chunking strategy is covered in Task 2.
- Embedding model and provider split are covered in Task 3.
- Local/dev deterministic embeddings are covered in Task 3 and Task 12.
- Token/cost ceilings are covered in Task 4 and Task 8.
- pgvector storage is covered in Task 5 and Task 6.
- Backend integration is covered in Task 10.
- Indexing trigger is covered in Task 9.
- OKF coverage source-of-truth rule is covered in the Scope and Data Model sections.
- Retrieval interface is covered in Task 10.
- Test plan is covered across Tasks 2, 3, 4, 6, 7, 8, 10, 12, and 14.

Deferred-work scan:

- No deferred implementation markers are used.
- Any optional future work is explicitly excluded from Stage 4.

Type consistency:

- Public RAG types live in `rag-types.ts`.
- Queue payloads use `documentId`, `workspaceId`, and `indexJobId`.
- Index job status uses `queued`, `running`, `completed`, and `failed`.
- Document RAG status uses `not_indexed`, `queued`, `running`, `indexed`, and `index_failed`.
