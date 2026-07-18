-- Durable parent workflow for LLM-assisted authoring. The workflow can prepare
-- review packages but cannot approve, export, or delete knowledge.
CREATE TABLE "KnowledgeAuthoringRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "currentStage" TEXT NOT NULL DEFAULT 'metadata_discovery',
    "completedStages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "enrichmentCandidateCount" INTEGER NOT NULL DEFAULT 0,
    "validationResults" JSONB NOT NULL DEFAULT '[]',
    "relationSuggestions" JSONB NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "costConfirmedAt" TIMESTAMP(3),
    "costConfirmedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeAuthoringRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeAuthoringStageAudit" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptSent" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeAuthoringStageAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentMetadataProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "proposedValues" JSONB NOT NULL,
    "previousValues" JSONB NOT NULL,
    "appliedValues" JSONB NOT NULL,
    "rationale" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneBy" TEXT,
    CONSTRAINT "DocumentMetadataProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeAuthoringRun_workspaceId_status_createdAt_idx" ON "KnowledgeAuthoringRun"("workspaceId", "status", "createdAt");
CREATE INDEX "KnowledgeAuthoringRun_documentId_createdAt_idx" ON "KnowledgeAuthoringRun"("documentId", "createdAt");
CREATE INDEX "KnowledgeAuthoringStageAudit_runId_createdAt_idx" ON "KnowledgeAuthoringStageAudit"("runId", "createdAt");
CREATE INDEX "DocumentMetadataProposal_runId_createdAt_idx" ON "DocumentMetadataProposal"("runId", "createdAt");
CREATE INDEX "DocumentMetadataProposal_documentId_createdAt_idx" ON "DocumentMetadataProposal"("documentId", "createdAt");

ALTER TABLE "KnowledgeAuthoringRun" ADD CONSTRAINT "KnowledgeAuthoringRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAuthoringRun" ADD CONSTRAINT "KnowledgeAuthoringRun_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAuthoringRun" ADD CONSTRAINT "KnowledgeAuthoringRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAuthoringStageAudit" ADD CONSTRAINT "KnowledgeAuthoringStageAudit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeAuthoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentMetadataProposal" ADD CONSTRAINT "DocumentMetadataProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeAuthoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
