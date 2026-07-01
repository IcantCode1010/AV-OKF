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
