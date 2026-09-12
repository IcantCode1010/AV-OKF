CREATE TABLE "DocumentUploadBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "totalFiles" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentUploadBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DocumentUploadSession" ADD COLUMN "batchId" TEXT;
ALTER TABLE "DocumentUploadSession" ADD COLUMN "batchOrdinal" INTEGER;

CREATE INDEX "DocumentUploadBatch_workspaceId_status_createdAt_idx" ON "DocumentUploadBatch"("workspaceId", "status", "createdAt");
CREATE INDEX "DocumentUploadBatch_knowledgeBundleId_status_createdAt_idx" ON "DocumentUploadBatch"("knowledgeBundleId", "status", "createdAt");
CREATE INDEX "DocumentUploadSession_batchId_status_idx" ON "DocumentUploadSession"("batchId", "status");
CREATE UNIQUE INDEX "DocumentUploadSession_batchId_batchOrdinal_key" ON "DocumentUploadSession"("batchId", "batchOrdinal");

ALTER TABLE "DocumentUploadBatch" ADD CONSTRAINT "DocumentUploadBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentUploadBatch" ADD CONSTRAINT "DocumentUploadBatch_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentUploadSession" ADD CONSTRAINT "DocumentUploadSession_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DocumentUploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
