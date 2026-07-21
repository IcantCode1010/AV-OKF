ALTER TABLE "Document"
DROP CONSTRAINT "Document_knowledgeBundleId_fkey";

ALTER TABLE "Document"
ALTER COLUMN "knowledgeBundleId" DROP NOT NULL;

ALTER TABLE "Document"
ADD CONSTRAINT "Document_knowledgeBundleId_fkey"
FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentDeletionJob"
DROP CONSTRAINT "DocumentDeletionJob_knowledgeBundleId_fkey";

ALTER TABLE "DocumentDeletionJob"
ALTER COLUMN "knowledgeBundleId" DROP NOT NULL;

ALTER TABLE "DocumentDeletionJob"
ADD CONSTRAINT "DocumentDeletionJob_knowledgeBundleId_fkey"
FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "KnowledgeBundleDeletionJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "bundleName" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "manifest" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBundleDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeBundleDeletionJob_bundleId_key" ON "KnowledgeBundleDeletionJob"("bundleId");
CREATE INDEX "KnowledgeBundleDeletionJob_workspaceId_status_queuedAt_idx" ON "KnowledgeBundleDeletionJob"("workspaceId", "status", "queuedAt");

ALTER TABLE "KnowledgeBundleDeletionJob"
ADD CONSTRAINT "KnowledgeBundleDeletionJob_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
