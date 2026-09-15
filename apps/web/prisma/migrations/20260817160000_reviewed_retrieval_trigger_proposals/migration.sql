CREATE TABLE "OkfRetrievalTriggerProposal" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "knowledgeGapId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "targetFilePath" TEXT NOT NULL,
  "targetTitle" TEXT NOT NULL,
  "targetContentHash" TEXT NOT NULL,
  "suggestedTerms" TEXT[] NOT NULL,
  "approvedTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "matchReason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OkfRetrievalTriggerProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OkfRetrievalTriggerProposal_workspaceId_knowledgeBundleId_fingerprint_key"
ON "OkfRetrievalTriggerProposal"("workspaceId", "knowledgeBundleId", "fingerprint");
CREATE INDEX "OkfRetrievalTriggerProposal_workspaceId_knowledgeBundleId_status_createdAt_idx"
ON "OkfRetrievalTriggerProposal"("workspaceId", "knowledgeBundleId", "status", "createdAt");
CREATE INDEX "OkfRetrievalTriggerProposal_knowledgeGapId_status_idx"
ON "OkfRetrievalTriggerProposal"("knowledgeGapId", "status");

ALTER TABLE "OkfRetrievalTriggerProposal" ADD CONSTRAINT "OkfRetrievalTriggerProposal_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfRetrievalTriggerProposal" ADD CONSTRAINT "OkfRetrievalTriggerProposal_knowledgeBundleId_fkey"
FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfRetrievalTriggerProposal" ADD CONSTRAINT "OkfRetrievalTriggerProposal_knowledgeGapId_fkey"
FOREIGN KEY ("knowledgeGapId") REFERENCES "KnowledgeGap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
