ALTER TABLE "ChatSession"
  ADD COLUMN "scopeVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ChatMessage"
  ADD COLUMN "knowledgeBundleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scopeVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "KnowledgeGap"
  ADD COLUMN "searchedKnowledgeBundleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ChatSession"
  DROP CONSTRAINT "ChatSession_knowledgeBundleId_fkey";

ALTER TABLE "KnowledgeGap"
  DROP CONSTRAINT "KnowledgeGap_knowledgeBundleId_fkey";

ALTER TABLE "ChatSession"
  ALTER COLUMN "knowledgeBundleId" DROP NOT NULL;

ALTER TABLE "KnowledgeGap"
  ALTER COLUMN "knowledgeBundleId" DROP NOT NULL;

ALTER TABLE "ChatSession"
  ADD CONSTRAINT "ChatSession_knowledgeBundleId_fkey"
  FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeGap"
  ADD CONSTRAINT "KnowledgeGap_knowledgeBundleId_fkey"
  FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChatSessionKnowledgeBundle" (
  "sessionId" TEXT NOT NULL,
  "knowledgeBundleId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "selectedBy" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSessionKnowledgeBundle_pkey"
    PRIMARY KEY ("sessionId", "knowledgeBundleId")
);

CREATE UNIQUE INDEX "ChatSessionKnowledgeBundle_sessionId_position_key"
  ON "ChatSessionKnowledgeBundle"("sessionId", "position");

CREATE INDEX "ChatSessionKnowledgeBundle_knowledgeBundleId_sessionId_idx"
  ON "ChatSessionKnowledgeBundle"("knowledgeBundleId", "sessionId");

ALTER TABLE "ChatSessionKnowledgeBundle"
  ADD CONSTRAINT "ChatSessionKnowledgeBundle_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatSessionKnowledgeBundle"
  ADD CONSTRAINT "ChatSessionKnowledgeBundle_knowledgeBundleId_fkey"
  FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ChatSessionKnowledgeBundle" (
  "sessionId",
  "knowledgeBundleId",
  "position",
  "selectedBy",
  "selectedAt"
)
SELECT
  "id",
  "knowledgeBundleId",
  0,
  "userId",
  "createdAt"
FROM "ChatSession"
WHERE "knowledgeBundleId" IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "ChatMessage" AS message
SET
  "knowledgeBundleIds" = ARRAY[session."knowledgeBundleId"],
  "scopeVersion" = session."scopeVersion"
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND session."knowledgeBundleId" IS NOT NULL;

UPDATE "KnowledgeGap"
SET "searchedKnowledgeBundleIds" = ARRAY["knowledgeBundleId"]
WHERE "knowledgeBundleId" IS NOT NULL;

DROP INDEX "ChatSession_knowledgeBundleId_updatedAt_idx";
CREATE INDEX "ChatSession_knowledgeBundleId_updatedAt_idx"
  ON "ChatSession"("knowledgeBundleId", "updatedAt");

DROP INDEX "KnowledgeGap_workspaceId_knowledgeBundleId_status_createdAt_idx";
CREATE INDEX "KnowledgeGap_workspaceId_knowledgeBundleId_status_createdAt_idx"
  ON "KnowledgeGap"("workspaceId", "knowledgeBundleId", "status", "createdAt");
