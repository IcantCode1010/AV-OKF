CREATE TABLE "TopicExpansionRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "corpusHash" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "approvedConceptCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "analyzedConceptCount" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "proposedCount" INTEGER NOT NULL DEFAULT 0,
    "filteredCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicExpansionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicExpansionProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "primaryDocumentId" TEXT NOT NULL,
    "promotedTopicId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "topicType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "identityFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicExpansionProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicExpansionEvidence" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "sourceTopicId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "sourceFilePath" TEXT NOT NULL,
    "sourcePages" INTEGER[],
    "evidenceQuote" TEXT NOT NULL,
    "conceptContentHash" TEXT NOT NULL,
    "chunkContentHash" TEXT NOT NULL,
    "trustTier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicExpansionEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicExpansionEnrichmentBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "selectionFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
    "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "costEstimate" JSONB NOT NULL DEFAULT '{}',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicExpansionEnrichmentBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicExpansionEnrichmentItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "topicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicExpansionEnrichmentItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicEnrichmentJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "proposalId" TEXT,
    "revisionFingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'topic-expansion-enrichment-v1',
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicEnrichmentJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicExpansionRun_knowledgeBundleId_corpusHash_key" ON "TopicExpansionRun"("knowledgeBundleId", "corpusHash");
CREATE INDEX "TopicExpansionRun_workspaceId_knowledgeBundleId_status_idx" ON "TopicExpansionRun"("workspaceId", "knowledgeBundleId", "status");
CREATE UNIQUE INDEX "TopicExpansionProposal_promotedTopicId_key" ON "TopicExpansionProposal"("promotedTopicId");
CREATE UNIQUE INDEX "TopicExpansionProposal_knowledgeBundleId_identityFingerprint_key" ON "TopicExpansionProposal"("knowledgeBundleId", "identityFingerprint");
CREATE INDEX "TopicExpansionProposal_workspaceId_knowledgeBundleId_status_rank_idx" ON "TopicExpansionProposal"("workspaceId", "knowledgeBundleId", "status", "rank");
CREATE INDEX "TopicExpansionProposal_runId_status_idx" ON "TopicExpansionProposal"("runId", "status");
CREATE UNIQUE INDEX "TopicExpansionEvidence_proposalId_sourceTopicId_chunkId_evidenceQuote_key" ON "TopicExpansionEvidence"("proposalId", "sourceTopicId", "chunkId", "evidenceQuote");
CREATE INDEX "TopicExpansionEvidence_documentId_proposalId_idx" ON "TopicExpansionEvidence"("documentId", "proposalId");
CREATE INDEX "TopicExpansionEvidence_sourceTopicId_idx" ON "TopicExpansionEvidence"("sourceTopicId");
CREATE UNIQUE INDEX "TopicExpansionEnrichmentBatch_knowledgeBundleId_selectionFingerprint_key" ON "TopicExpansionEnrichmentBatch"("knowledgeBundleId", "selectionFingerprint");
CREATE INDEX "TopicExpansionEnrichmentBatch_workspaceId_knowledgeBundleId_status_idx" ON "TopicExpansionEnrichmentBatch"("workspaceId", "knowledgeBundleId", "status");
CREATE UNIQUE INDEX "TopicExpansionEnrichmentItem_batchId_proposalId_key" ON "TopicExpansionEnrichmentItem"("batchId", "proposalId");
CREATE INDEX "TopicExpansionEnrichmentItem_batchId_status_idx" ON "TopicExpansionEnrichmentItem"("batchId", "status");
CREATE UNIQUE INDEX "TopicEnrichmentJob_topicId_revisionFingerprint_key" ON "TopicEnrichmentJob"("topicId", "revisionFingerprint");
CREATE INDEX "TopicEnrichmentJob_workspaceId_status_queuedAt_idx" ON "TopicEnrichmentJob"("workspaceId", "status", "queuedAt");
CREATE INDEX "TopicEnrichmentJob_knowledgeBundleId_status_idx" ON "TopicEnrichmentJob"("knowledgeBundleId", "status");

ALTER TABLE "TopicExpansionRun" ADD CONSTRAINT "TopicExpansionRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionRun" ADD CONSTRAINT "TopicExpansionRun_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionProposal" ADD CONSTRAINT "TopicExpansionProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionProposal" ADD CONSTRAINT "TopicExpansionProposal_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionProposal" ADD CONSTRAINT "TopicExpansionProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TopicExpansionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionProposal" ADD CONSTRAINT "TopicExpansionProposal_primaryDocumentId_fkey" FOREIGN KEY ("primaryDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionProposal" ADD CONSTRAINT "TopicExpansionProposal_promotedTopicId_fkey" FOREIGN KEY ("promotedTopicId") REFERENCES "TopicRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEvidence" ADD CONSTRAINT "TopicExpansionEvidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TopicExpansionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEvidence" ADD CONSTRAINT "TopicExpansionEvidence_sourceTopicId_fkey" FOREIGN KEY ("sourceTopicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEvidence" ADD CONSTRAINT "TopicExpansionEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEvidence" ADD CONSTRAINT "TopicExpansionEvidence_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "RagChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEnrichmentBatch" ADD CONSTRAINT "TopicExpansionEnrichmentBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEnrichmentBatch" ADD CONSTRAINT "TopicExpansionEnrichmentBatch_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEnrichmentItem" ADD CONSTRAINT "TopicExpansionEnrichmentItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TopicExpansionEnrichmentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionEnrichmentItem" ADD CONSTRAINT "TopicExpansionEnrichmentItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TopicExpansionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicEnrichmentJob" ADD CONSTRAINT "TopicEnrichmentJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicEnrichmentJob" ADD CONSTRAINT "TopicEnrichmentJob_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicEnrichmentJob" ADD CONSTRAINT "TopicEnrichmentJob_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicEnrichmentJob" ADD CONSTRAINT "TopicEnrichmentJob_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TopicExpansionProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
