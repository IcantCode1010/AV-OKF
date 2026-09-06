ALTER TABLE "OkfRelationCandidate"
  ADD COLUMN "evidenceChunkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "evidencePageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "evidenceSourceQuote" TEXT,
  ADD COLUMN "targetAnchor" TEXT,
  ADD COLUMN "targetResolution" TEXT;

CREATE TABLE "CanonicalEntity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'provisional',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanonicalEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityAlias" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityCandidate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "canonicalEntityId" TEXT,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL DEFAULT '',
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidenceQuote" TEXT NOT NULL,
  "pageNumbers" INTEGER[] NOT NULL,
  "chunkIds" TEXT[] NOT NULL,
  "aliases" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'validated',
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityOccurrence" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "pageNumbers" INTEGER[] NOT NULL,
  "evidenceQuote" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityBundleClassification" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "subjectFamily" TEXT,
  "ataChapter" TEXT,
  "systemFamily" TEXT,
  "classificationCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityBundleClassification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityTopicLink" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityTopicLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityExtractionJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "revisionHash" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL DEFAULT 'entity-grounding-v1',
  "provider" TEXT,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "entityCount" INTEGER NOT NULL DEFAULT 0,
  "relationCount" INTEGER NOT NULL DEFAULT 0,
  "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityExtractionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityExpansionRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "triggerTopicId" TEXT,
  "triggerFingerprint" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'incremental',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "proposedCount" INTEGER NOT NULL DEFAULT 0,
  "resolvedCount" INTEGER NOT NULL DEFAULT 0,
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "filteredCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityExpansionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityRelationCandidate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "expansionRunId" TEXT,
  "sourceTopicId" TEXT NOT NULL,
  "targetTopicId" TEXT,
  "sourceEntityId" TEXT,
  "targetEntityId" TEXT,
  "relation" TEXT NOT NULL,
  "evidenceQuote" TEXT NOT NULL,
  "evidenceChunkIds" TEXT[] NOT NULL,
  "evidencePageNumbers" INTEGER[] NOT NULL,
  "targetAnchor" TEXT,
  "targetResolution" TEXT,
  "targetResolutionValue" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rationale" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unresolved',
  "contentHash" TEXT NOT NULL,
  "projectedCandidateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityRelationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityRelationEvidence" (
  "id" TEXT NOT NULL,
  "relationCandidateId" TEXT NOT NULL,
  "occurrenceId" TEXT,
  "chunkId" TEXT NOT NULL,
  "pageNumbers" INTEGER[] NOT NULL,
  "evidenceQuote" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityRelationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalEntity_workspaceId_normalizedName_entityType_identityKey_key" ON "CanonicalEntity"("workspaceId", "normalizedName", "entityType", "identityKey");
CREATE INDEX "CanonicalEntity_workspaceId_status_normalizedName_idx" ON "CanonicalEntity"("workspaceId", "status", "normalizedName");
CREATE UNIQUE INDEX "EntityAlias_entityId_normalizedValue_key" ON "EntityAlias"("entityId", "normalizedValue");
CREATE INDEX "EntityAlias_normalizedValue_status_idx" ON "EntityAlias"("normalizedValue", "status");
CREATE UNIQUE INDEX "EntityCandidate_topicId_normalizedName_entityType_evidenceQuote_key" ON "EntityCandidate"("topicId", "normalizedName", "entityType", "evidenceQuote");
CREATE INDEX "EntityCandidate_workspaceId_normalizedName_entityType_status_idx" ON "EntityCandidate"("workspaceId", "normalizedName", "entityType", "status");
CREATE INDEX "EntityCandidate_knowledgeBundleId_status_idx" ON "EntityCandidate"("knowledgeBundleId", "status");
CREATE UNIQUE INDEX "EntityOccurrence_entityId_topicId_chunkId_evidenceQuote_key" ON "EntityOccurrence"("entityId", "topicId", "chunkId", "evidenceQuote");
CREATE INDEX "EntityOccurrence_workspaceId_entityId_idx" ON "EntityOccurrence"("workspaceId", "entityId");
CREATE INDEX "EntityOccurrence_knowledgeBundleId_documentId_idx" ON "EntityOccurrence"("knowledgeBundleId", "documentId");
CREATE UNIQUE INDEX "EntityBundleClassification_entityId_knowledgeBundleId_key" ON "EntityBundleClassification"("entityId", "knowledgeBundleId");
CREATE INDEX "EntityBundleClassification_knowledgeBundleId_status_idx" ON "EntityBundleClassification"("knowledgeBundleId", "status");
CREATE UNIQUE INDEX "EntityTopicLink_entityId_knowledgeBundleId_key" ON "EntityTopicLink"("entityId", "knowledgeBundleId");
CREATE UNIQUE INDEX "EntityTopicLink_topicId_entityId_key" ON "EntityTopicLink"("topicId", "entityId");
CREATE INDEX "EntityTopicLink_knowledgeBundleId_status_idx" ON "EntityTopicLink"("knowledgeBundleId", "status");
CREATE UNIQUE INDEX "EntityExtractionJob_topicId_revisionHash_key" ON "EntityExtractionJob"("topicId", "revisionHash");
CREATE INDEX "EntityExtractionJob_workspaceId_status_queuedAt_idx" ON "EntityExtractionJob"("workspaceId", "status", "queuedAt");
CREATE INDEX "EntityExtractionJob_documentId_status_idx" ON "EntityExtractionJob"("documentId", "status");
CREATE UNIQUE INDEX "EntityExpansionRun_knowledgeBundleId_triggerFingerprint_key" ON "EntityExpansionRun"("knowledgeBundleId", "triggerFingerprint");
CREATE INDEX "EntityExpansionRun_workspaceId_knowledgeBundleId_status_idx" ON "EntityExpansionRun"("workspaceId", "knowledgeBundleId", "status");
CREATE UNIQUE INDEX "EntityRelationCandidate_projectedCandidateId_key" ON "EntityRelationCandidate"("projectedCandidateId");
CREATE UNIQUE INDEX "EntityRelationCandidate_knowledgeBundleId_sourceTopicId_relation_targetResolutionValue_contentHash_key" ON "EntityRelationCandidate"("knowledgeBundleId", "sourceTopicId", "relation", "targetResolutionValue", "contentHash");
CREATE INDEX "EntityRelationCandidate_workspaceId_knowledgeBundleId_status_idx" ON "EntityRelationCandidate"("workspaceId", "knowledgeBundleId", "status");
CREATE INDEX "EntityRelationCandidate_sourceTopicId_targetTopicId_idx" ON "EntityRelationCandidate"("sourceTopicId", "targetTopicId");
CREATE UNIQUE INDEX "EntityRelationEvidence_relationCandidateId_chunkId_evidenceQuote_key" ON "EntityRelationEvidence"("relationCandidateId", "chunkId", "evidenceQuote");
CREATE INDEX "EntityRelationEvidence_chunkId_idx" ON "EntityRelationEvidence"("chunkId");

ALTER TABLE "CanonicalEntity" ADD CONSTRAINT "CanonicalEntity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CanonicalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityCandidate" ADD CONSTRAINT "EntityCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityCandidate" ADD CONSTRAINT "EntityCandidate_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityCandidate" ADD CONSTRAINT "EntityCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityCandidate" ADD CONSTRAINT "EntityCandidate_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityCandidate" ADD CONSTRAINT "EntityCandidate_canonicalEntityId_fkey" FOREIGN KEY ("canonicalEntityId") REFERENCES "CanonicalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CanonicalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityOccurrence" ADD CONSTRAINT "EntityOccurrence_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "RagChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityBundleClassification" ADD CONSTRAINT "EntityBundleClassification_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CanonicalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityBundleClassification" ADD CONSTRAINT "EntityBundleClassification_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityTopicLink" ADD CONSTRAINT "EntityTopicLink_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CanonicalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityTopicLink" ADD CONSTRAINT "EntityTopicLink_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityTopicLink" ADD CONSTRAINT "EntityTopicLink_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExtractionJob" ADD CONSTRAINT "EntityExtractionJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExtractionJob" ADD CONSTRAINT "EntityExtractionJob_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExtractionJob" ADD CONSTRAINT "EntityExtractionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExtractionJob" ADD CONSTRAINT "EntityExtractionJob_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExpansionRun" ADD CONSTRAINT "EntityExpansionRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityExpansionRun" ADD CONSTRAINT "EntityExpansionRun_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_expansionRunId_fkey" FOREIGN KEY ("expansionRunId") REFERENCES "EntityExpansionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_sourceTopicId_fkey" FOREIGN KEY ("sourceTopicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_targetTopicId_fkey" FOREIGN KEY ("targetTopicId") REFERENCES "TopicRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "CanonicalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "CanonicalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityRelationCandidate" ADD CONSTRAINT "EntityRelationCandidate_projectedCandidateId_fkey" FOREIGN KEY ("projectedCandidateId") REFERENCES "OkfRelationCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityRelationEvidence" ADD CONSTRAINT "EntityRelationEvidence_relationCandidateId_fkey" FOREIGN KEY ("relationCandidateId") REFERENCES "EntityRelationCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelationEvidence" ADD CONSTRAINT "EntityRelationEvidence_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "EntityOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
