ALTER TABLE "KnowledgeAuthoringRun"
ADD COLUMN "automaticRelationApprovalEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OkfRelationCandidate"
ADD COLUMN "authoringRunId" TEXT,
ADD COLUMN "automaticApprovalRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "automaticApprovalActor" TEXT,
ADD COLUMN "automaticApprovalError" TEXT;

CREATE INDEX "OkfRelationCandidate_authoringRunId_automaticApprovalRequested_idx"
ON "OkfRelationCandidate"("authoringRunId", "automaticApprovalRequested");

ALTER TABLE "OkfRelationCandidate"
ADD CONSTRAINT "OkfRelationCandidate_authoringRunId_fkey"
FOREIGN KEY ("authoringRunId") REFERENCES "KnowledgeAuthoringRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
