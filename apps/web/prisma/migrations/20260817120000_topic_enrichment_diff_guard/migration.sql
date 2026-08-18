ALTER TABLE "TopicEnrichmentAudit"
ADD COLUMN "baselineFingerprint" TEXT,
ADD COLUMN "baselineTitle" TEXT,
ADD COLUMN "baselineSummary" TEXT,
ADD COLUMN "baselineBody" TEXT,
ADD COLUMN "baselineProposedSourcePageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "candidateTitle" TEXT,
ADD COLUMN "candidateSummary" TEXT,
ADD COLUMN "candidateBody" TEXT,
ADD COLUMN "candidateProposedSourcePageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "diff" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "disposition" TEXT NOT NULL DEFAULT 'applied',
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedBy" TEXT;

UPDATE "TopicEnrichmentAudit"
SET "disposition" = 'failed'
WHERE "succeeded" = false;

CREATE INDEX "TopicEnrichmentAudit_topicId_disposition_createdAt_idx"
ON "TopicEnrichmentAudit"("topicId", "disposition", "createdAt");
