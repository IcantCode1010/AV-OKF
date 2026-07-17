CREATE TABLE "TopicDiscoveryJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "provider" TEXT,
  "model" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "completedWindows" INTEGER NOT NULL DEFAULT 0,
  "totalWindows" INTEGER NOT NULL DEFAULT 0,
  "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "TopicDiscoveryJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TopicDiscoveryAudit" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "windowOrdinal" INTEGER,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptSent" TEXT NOT NULL,
  "rawResponse" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "succeeded" BOOLEAN NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TopicDiscoveryAudit_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TopicRecord" ADD COLUMN "enrichedBody" TEXT;
ALTER TABLE "TopicRecord" ADD COLUMN "proposedSourcePageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "TopicRecord" ADD COLUMN "discoveryMetadata" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "TopicDiscoveryJob_status_queuedAt_idx" ON "TopicDiscoveryJob"("status", "queuedAt");
CREATE INDEX "TopicDiscoveryJob_workspaceId_documentId_queuedAt_idx" ON "TopicDiscoveryJob"("workspaceId", "documentId", "queuedAt");
CREATE INDEX "TopicDiscoveryAudit_jobId_createdAt_idx" ON "TopicDiscoveryAudit"("jobId", "createdAt");
ALTER TABLE "TopicDiscoveryJob" ADD CONSTRAINT "TopicDiscoveryJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicDiscoveryJob" ADD CONSTRAINT "TopicDiscoveryJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicDiscoveryAudit" ADD CONSTRAINT "TopicDiscoveryAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TopicDiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
