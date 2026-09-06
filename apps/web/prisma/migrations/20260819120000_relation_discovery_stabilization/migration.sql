ALTER TABLE "OkfRelationCandidate"
  ADD COLUMN "publishedReviewStatus" TEXT,
  ADD COLUMN "publishedReviewFlaggedAt" TIMESTAMP(3),
  ADD COLUMN "publishedSourceFile" TEXT,
  ADD COLUMN "publishedTargetFile" TEXT,
  ADD COLUMN "publishedRelation" TEXT,
  ADD COLUMN "publishedReason" TEXT;

ALTER TABLE "OkfRelationDiscoveryRun"
  ADD COLUMN "proposedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "skippedExistingCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OkfRelationCandidate_knowledgeBundleId_publishedReviewStatus_idx"
  ON "OkfRelationCandidate"("knowledgeBundleId", "publishedReviewStatus");
