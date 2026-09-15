ALTER TABLE "KnowledgeAuthoringRun"
ADD COLUMN "extractionJobId" TEXT;

CREATE UNIQUE INDEX "KnowledgeAuthoringRun_workspaceId_documentId_extractionJobId_key"
ON "KnowledgeAuthoringRun"("workspaceId", "documentId", "extractionJobId");
