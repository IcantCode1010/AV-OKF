ALTER TABLE "TopicExpansionResearchJob"
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "currentRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "stopReason" TEXT;

UPDATE "TopicExpansionResearchJob"
SET
  "stage" = CASE
    WHEN "status" = 'completed' THEN 'completed'
    WHEN "status" = 'failed' THEN 'failed'
    WHEN "status" = 'cancelled' THEN 'cancelled'
    WHEN "status" = 'running' THEN 'planning_retrieval'
    ELSE 'queued'
  END,
  "currentRound" = "completedRounds",
  "heartbeatAt" = "updatedAt";
