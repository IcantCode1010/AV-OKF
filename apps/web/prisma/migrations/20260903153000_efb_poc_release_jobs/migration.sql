-- CreateTable
CREATE TABLE "EfbReleaseJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authoringRunId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'poc',
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "corpusHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "releaseDirectory" TEXT,
    "manifestPath" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EfbReleaseJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EfbReleaseJob_knowledgeBundleId_corpusHash_mode_key" ON "EfbReleaseJob"("knowledgeBundleId", "corpusHash", "mode");
CREATE UNIQUE INDEX "EfbReleaseJob_packageId_version_key" ON "EfbReleaseJob"("packageId", "version");
CREATE INDEX "EfbReleaseJob_workspaceId_status_createdAt_idx" ON "EfbReleaseJob"("workspaceId", "status", "createdAt");
CREATE INDEX "EfbReleaseJob_documentId_createdAt_idx" ON "EfbReleaseJob"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "EfbReleaseJob" ADD CONSTRAINT "EfbReleaseJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfbReleaseJob" ADD CONSTRAINT "EfbReleaseJob_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfbReleaseJob" ADD CONSTRAINT "EfbReleaseJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfbReleaseJob" ADD CONSTRAINT "EfbReleaseJob_authoringRunId_fkey" FOREIGN KEY ("authoringRunId") REFERENCES "KnowledgeAuthoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
