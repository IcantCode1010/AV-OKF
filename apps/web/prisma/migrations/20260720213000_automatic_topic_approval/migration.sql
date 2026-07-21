ALTER TABLE "KnowledgeAuthoringRun"
ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "automaticTopicApprovalEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TopicRecord"
ADD COLUMN "approvalMode" TEXT,
ADD COLUMN "approvedBy" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "BulkTopicApprovalRun"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'human',
ADD COLUMN "authoringRunId" TEXT;

CREATE UNIQUE INDEX "BulkTopicApprovalRun_authoringRunId_key"
ON "BulkTopicApprovalRun"("authoringRunId");

ALTER TABLE "BulkTopicApprovalRun"
ADD CONSTRAINT "BulkTopicApprovalRun_authoringRunId_fkey"
FOREIGN KEY ("authoringRunId") REFERENCES "KnowledgeAuthoringRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
