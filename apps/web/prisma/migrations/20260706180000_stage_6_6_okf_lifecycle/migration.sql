-- Stage 6.6 lifecycle projection for exported OKF concept files.
-- OKF Markdown remains the portable content source of truth; this table stores
-- workspace-scoped lifecycle state used by app read paths and future actions.
ALTER TABLE "Document" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Document" ADD COLUMN "deleteReason" TEXT;

CREATE TABLE "OkfConceptLifecycle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "topicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OkfConceptLifecycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OkfConceptLifecycle_workspaceId_filePath_key" ON "OkfConceptLifecycle"("workspaceId", "filePath");
CREATE INDEX "OkfConceptLifecycle_workspaceId_status_idx" ON "OkfConceptLifecycle"("workspaceId", "status");
CREATE INDEX "OkfConceptLifecycle_workspaceId_topicId_idx" ON "OkfConceptLifecycle"("workspaceId", "topicId");

ALTER TABLE "OkfConceptLifecycle" ADD CONSTRAINT "OkfConceptLifecycle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
