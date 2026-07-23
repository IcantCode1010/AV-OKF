-- Relation Discovery V3 starts from fresh deterministic candidates. Approved
-- and human-rejected history, plus every OKF file, remain untouched.
DELETE FROM "OkfRelationCandidate" WHERE "status" = 'pending';

ALTER TABLE "OkfRelationCandidate"
  ADD COLUMN "discoveryRunId" TEXT,
  ADD COLUMN "discoveryVersion" TEXT NOT NULL DEFAULT 'deterministic-v2',
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "verificationProvider" TEXT,
  ADD COLUMN "verificationModel" TEXT,
  ADD COLUMN "verificationRelation" TEXT,
  ADD COLUMN "verificationDirection" TEXT,
  ADD COLUMN "verificationEvidenceQuote" TEXT,
  ADD COLUMN "verificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "verificationRationale" TEXT,
  ADD COLUMN "verificationError" TEXT,
  ADD COLUMN "verifierVersion" TEXT,
  ADD COLUMN "sourceContentHash" TEXT,
  ADD COLUMN "targetContentHash" TEXT,
  ADD COLUMN "requestedDirection" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE TABLE "OkfRelationDiscoveryRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "totalCandidates" INTEGER NOT NULL DEFAULT 0,
  "suppressedCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "runningCount" INTEGER NOT NULL DEFAULT 0,
  "confirmedCount" INTEGER NOT NULL DEFAULT 0,
  "filteredCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OkfRelationDiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OkfRelationVerificationAttempt" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "promptSent" TEXT NOT NULL,
  "rawResponse" TEXT,
  "result" JSONB,
  "succeeded" BOOLEAN NOT NULL DEFAULT false,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OkfRelationVerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OkfRelationCandidate_knowledgeBundleId_verificationStatus_idx"
  ON "OkfRelationCandidate"("knowledgeBundleId", "verificationStatus");
CREATE INDEX "OkfRelationDiscoveryRun_workspaceId_knowledgeBundleId_status_idx"
  ON "OkfRelationDiscoveryRun"("workspaceId", "knowledgeBundleId", "status");
CREATE INDEX "OkfRelationVerificationAttempt_candidateId_createdAt_idx"
  ON "OkfRelationVerificationAttempt"("candidateId", "createdAt");

ALTER TABLE "OkfRelationCandidate"
  ADD CONSTRAINT "OkfRelationCandidate_discoveryRunId_fkey"
  FOREIGN KEY ("discoveryRunId") REFERENCES "OkfRelationDiscoveryRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OkfRelationDiscoveryRun"
  ADD CONSTRAINT "OkfRelationDiscoveryRun_knowledgeBundleId_fkey"
  FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfRelationVerificationAttempt"
  ADD CONSTRAINT "OkfRelationVerificationAttempt_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "OkfRelationCandidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
