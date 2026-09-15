CREATE TABLE "DocumentUploadSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "expectedSizeBytes" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentUploadSession_documentId_key" ON "DocumentUploadSession"("documentId");
CREATE UNIQUE INDEX "DocumentUploadSession_objectKey_key" ON "DocumentUploadSession"("objectKey");
CREATE INDEX "DocumentUploadSession_workspaceId_status_expiresAt_idx" ON "DocumentUploadSession"("workspaceId", "status", "expiresAt");
CREATE INDEX "DocumentUploadSession_knowledgeBundleId_status_idx" ON "DocumentUploadSession"("knowledgeBundleId", "status");

ALTER TABLE "DocumentUploadSession" ADD CONSTRAINT "DocumentUploadSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentUploadSession" ADD CONSTRAINT "DocumentUploadSession_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
