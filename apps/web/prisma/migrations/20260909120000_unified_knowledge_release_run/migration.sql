CREATE TABLE "KnowledgeReleaseRun" (
  "id" TEXT NOT NULL,
  "triggerKey" TEXT,
  "workspaceId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "currentStage" TEXT NOT NULL DEFAULT 'gate_selection',
  "completedStages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "selectionSnapshot" JSONB NOT NULL,
  "registryHash" TEXT NOT NULL,
  "packageId" TEXT,
  "packageVersion" TEXT,
  "releaseDirectory" TEXT,
  "receiverRevisionId" TEXT,
  "previousReceiverRevisionId" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeReleaseRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeReleaseRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KnowledgeReleaseRun_workspaceId_status_createdAt_idx" ON "KnowledgeReleaseRun"("workspaceId", "status", "createdAt");
CREATE INDEX "KnowledgeReleaseRun_workspaceId_packageId_packageVersion_idx" ON "KnowledgeReleaseRun"("workspaceId", "packageId", "packageVersion");
CREATE UNIQUE INDEX "KnowledgeReleaseRun_triggerKey_key" ON "KnowledgeReleaseRun"("triggerKey");
