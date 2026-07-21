ALTER TABLE "TopicRecord" ADD COLUMN "bulkApprovalRunId" TEXT;

CREATE TABLE "BulkTopicApprovalRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
    "estimatedEmbeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkTopicApprovalRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkTopicApprovalItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revisionFingerprint" TEXT NOT NULL,
    "estimatedEmbeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "exportedFilePath" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkTopicApprovalItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicRecord_bulkApprovalRunId_idx" ON "TopicRecord"("bulkApprovalRunId");
CREATE INDEX "BulkTopicApprovalRun_workspaceId_knowledgeBundleId_createdAt_idx" ON "BulkTopicApprovalRun"("workspaceId", "knowledgeBundleId", "createdAt");
CREATE INDEX "BulkTopicApprovalRun_status_createdAt_idx" ON "BulkTopicApprovalRun"("status", "createdAt");
CREATE UNIQUE INDEX "BulkTopicApprovalItem_runId_topicId_key" ON "BulkTopicApprovalItem"("runId", "topicId");
CREATE INDEX "BulkTopicApprovalItem_workspaceId_knowledgeBundleId_status_idx" ON "BulkTopicApprovalItem"("workspaceId", "knowledgeBundleId", "status");
CREATE INDEX "BulkTopicApprovalItem_topicId_status_idx" ON "BulkTopicApprovalItem"("topicId", "status");

ALTER TABLE "BulkTopicApprovalRun" ADD CONSTRAINT "BulkTopicApprovalRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkTopicApprovalRun" ADD CONSTRAINT "BulkTopicApprovalRun_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkTopicApprovalItem" ADD CONSTRAINT "BulkTopicApprovalItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BulkTopicApprovalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkTopicApprovalItem" ADD CONSTRAINT "BulkTopicApprovalItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkTopicApprovalItem" ADD CONSTRAINT "BulkTopicApprovalItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
