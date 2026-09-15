ALTER TABLE "Document"
  ADD COLUMN "inspectionStatus" TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN "inspectionWarnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "inspectedAt" TIMESTAMP(3),
  ADD COLUMN "ocrPageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unreadablePageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "ExtractedPage"
  ADD COLUMN "extractionMethod" TEXT NOT NULL DEFAULT 'digital',
  ADD COLUMN "ocrConfidence" DOUBLE PRECISION,
  ADD COLUMN "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "KnowledgeAuthoringRun" ADD COLUMN "costEstimate" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "DocumentProcessingCheckpoint" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "pageStart" INTEGER NOT NULL,
  "pageEnd" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "outputHash" TEXT,
  "outputKey" TEXT,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentProcessingCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentProcessingCheckpoint_jobId_stage_batchIndex_key" ON "DocumentProcessingCheckpoint"("jobId", "stage", "batchIndex");
CREATE INDEX "DocumentProcessingCheckpoint_documentId_stage_status_idx" ON "DocumentProcessingCheckpoint"("documentId", "stage", "status");
ALTER TABLE "DocumentProcessingCheckpoint" ADD CONSTRAINT "DocumentProcessingCheckpoint_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExtractionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentProcessingCheckpoint" ADD CONSTRAINT "DocumentProcessingCheckpoint_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TopicDiscoveryWindow" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "pageStart" INTEGER NOT NULL,
  "pageEnd" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "candidates" JSONB NOT NULL DEFAULT '[]',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopicDiscoveryWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TopicDiscoveryWindow_jobId_ordinal_key" ON "TopicDiscoveryWindow"("jobId", "ordinal");
CREATE INDEX "TopicDiscoveryWindow_documentId_status_idx" ON "TopicDiscoveryWindow"("documentId", "status");
ALTER TABLE "TopicDiscoveryWindow" ADD CONSTRAINT "TopicDiscoveryWindow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TopicDiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicDiscoveryWindow" ADD CONSTRAINT "TopicDiscoveryWindow_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GroundedCrawlerCandidate" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "seedHash" TEXT NOT NULL,
  "candidateType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "evidenceChunkIds" TEXT[] NOT NULL,
  "sourcePages" INTEGER[] NOT NULL,
  "evidenceQuote" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'validated',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroundedCrawlerCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroundedCrawlerCandidate_documentId_seedHash_candidateType_evidenceQuote_key" ON "GroundedCrawlerCandidate"("documentId", "seedHash", "candidateType", "evidenceQuote");
CREATE INDEX "GroundedCrawlerCandidate_documentId_status_idx" ON "GroundedCrawlerCandidate"("documentId", "status");
ALTER TABLE "GroundedCrawlerCandidate" ADD CONSTRAINT "GroundedCrawlerCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RagIndexBatchCheckpoint" (
  "id" TEXT NOT NULL,
  "indexJobId" TEXT NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "chunkStart" INTEGER NOT NULL,
  "chunkEnd" INTEGER NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RagIndexBatchCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RagIndexBatchCheckpoint_indexJobId_batchIndex_key" ON "RagIndexBatchCheckpoint"("indexJobId", "batchIndex");
CREATE INDEX "RagIndexBatchCheckpoint_status_updatedAt_idx" ON "RagIndexBatchCheckpoint"("status", "updatedAt");
ALTER TABLE "RagIndexBatchCheckpoint" ADD CONSTRAINT "RagIndexBatchCheckpoint_indexJobId_fkey" FOREIGN KEY ("indexJobId") REFERENCES "RagIndexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
