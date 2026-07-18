CREATE TABLE "OkfConceptEmbedding" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OkfConceptEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OkfConceptEmbeddingJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "bundleName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OkfConceptEmbeddingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OkfConceptEmbedding_knowledgeBundleId_filePath_key" ON "OkfConceptEmbedding"("knowledgeBundleId", "filePath");
CREATE INDEX "OkfConceptEmbedding_workspaceId_knowledgeBundleId_idx" ON "OkfConceptEmbedding"("workspaceId", "knowledgeBundleId");
CREATE INDEX "OkfConceptEmbedding_contentHash_idx" ON "OkfConceptEmbedding"("contentHash");
CREATE UNIQUE INDEX "OkfConceptEmbeddingJob_knowledgeBundleId_filePath_contentHash_key" ON "OkfConceptEmbeddingJob"("knowledgeBundleId", "filePath", "contentHash");
CREATE INDEX "OkfConceptEmbeddingJob_status_queuedAt_idx" ON "OkfConceptEmbeddingJob"("status", "queuedAt");
CREATE INDEX "OkfConceptEmbeddingJob_workspaceId_status_idx" ON "OkfConceptEmbeddingJob"("workspaceId", "status");

ALTER TABLE "OkfConceptEmbedding" ADD CONSTRAINT "OkfConceptEmbedding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfConceptEmbedding" ADD CONSTRAINT "OkfConceptEmbedding_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfConceptEmbeddingJob" ADD CONSTRAINT "OkfConceptEmbeddingJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfConceptEmbeddingJob" ADD CONSTRAINT "OkfConceptEmbeddingJob_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
