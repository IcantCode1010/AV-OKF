CREATE TABLE "RagRerankDailyUsage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "usageDate" TEXT NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RagRerankDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RagRerankDailyUsage_workspaceId_usageDate_key"
  ON "RagRerankDailyUsage"("workspaceId", "usageDate");

ALTER TABLE "RagRerankDailyUsage"
  ADD CONSTRAINT "RagRerankDailyUsage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
