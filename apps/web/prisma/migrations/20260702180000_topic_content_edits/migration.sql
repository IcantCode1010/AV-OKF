ALTER TABLE "TopicRecord"
ADD COLUMN "originalTitle" TEXT,
ADD COLUMN "originalSummary" TEXT,
ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "editedBy" TEXT;

UPDATE "TopicRecord"
SET
  "originalTitle" = "title",
  "originalSummary" = "summary";

ALTER TABLE "TopicRecord"
ALTER COLUMN "originalTitle" SET NOT NULL,
ALTER COLUMN "originalSummary" SET NOT NULL;
