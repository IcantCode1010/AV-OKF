ALTER TABLE "TopicRecord"
ADD COLUMN "enrichedTitle" TEXT,
ADD COLUMN "enrichedSummary" TEXT,
ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "approvedContentSource" TEXT;

CREATE TABLE "TopicEnrichmentAudit" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptSent" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "TopicEnrichmentAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicEnrichmentAudit_topicId_createdAt_idx"
ON "TopicEnrichmentAudit"("topicId", "createdAt");

ALTER TABLE "TopicEnrichmentAudit"
ADD CONSTRAINT "TopicEnrichmentAudit_topicId_fkey"
FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
