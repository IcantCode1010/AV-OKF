ALTER TABLE "RagChunk"
ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'raw_extraction',
ADD COLUMN "sourceTopicId" TEXT;

CREATE INDEX "RagChunk_workspaceId_documentId_sourceType_idx"
ON "RagChunk"("workspaceId", "documentId", "sourceType");

CREATE INDEX "RagChunk_workspaceId_sourceType_sourceTopicId_idx"
ON "RagChunk"("workspaceId", "sourceType", "sourceTopicId");
