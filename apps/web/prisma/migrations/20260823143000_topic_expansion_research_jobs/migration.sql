CREATE TABLE "TopicExpansionResearchJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceTopicId" TEXT NOT NULL,
    "sourceContentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completedRounds" INTEGER NOT NULL DEFAULT 0,
    "searchQueryCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceChunkCount" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicExpansionResearchJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicExpansionResearchJob_runId_sourceTopicId_key" ON "TopicExpansionResearchJob"("runId", "sourceTopicId");
CREATE INDEX "TopicExpansionResearchJob_workspaceId_knowledgeBundleId_status_idx" ON "TopicExpansionResearchJob"("workspaceId", "knowledgeBundleId", "status");
CREATE INDEX "TopicExpansionResearchJob_runId_status_idx" ON "TopicExpansionResearchJob"("runId", "status");

ALTER TABLE "TopicExpansionResearchJob" ADD CONSTRAINT "TopicExpansionResearchJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionResearchJob" ADD CONSTRAINT "TopicExpansionResearchJob_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionResearchJob" ADD CONSTRAINT "TopicExpansionResearchJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TopicExpansionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicExpansionResearchJob" ADD CONSTRAINT "TopicExpansionResearchJob_sourceTopicId_fkey" FOREIGN KEY ("sourceTopicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
