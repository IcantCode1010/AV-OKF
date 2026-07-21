CREATE TABLE "DocumentDeletionJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "manifest" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentDeletionJob_documentId_key" ON "DocumentDeletionJob"("documentId");
CREATE INDEX "DocumentDeletionJob_workspaceId_status_queuedAt_idx" ON "DocumentDeletionJob"("workspaceId", "status", "queuedAt");
CREATE INDEX "DocumentDeletionJob_knowledgeBundleId_status_idx" ON "DocumentDeletionJob"("knowledgeBundleId", "status");

ALTER TABLE "DocumentDeletionJob"
ADD CONSTRAINT "DocumentDeletionJob_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentDeletionJob"
ADD CONSTRAINT "DocumentDeletionJob_knowledgeBundleId_fkey"
FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
