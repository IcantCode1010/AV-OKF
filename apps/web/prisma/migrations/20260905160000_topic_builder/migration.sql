CREATE TABLE "TopicBuilderRecipe" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
 "topic" TEXT NOT NULL, "audience" TEXT NOT NULL, "applicability" TEXT NOT NULL,
 "instructions" TEXT NOT NULL, "collectionIds" TEXT[] NOT NULL, "maxWords" INTEGER NOT NULL DEFAULT 180,
 "approvedRunId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "TopicBuilderRecipe_workspaceId_updatedAt_idx" ON "TopicBuilderRecipe"("workspaceId","updatedAt");
CREATE TABLE "TopicBuilderRun" (
 "id" TEXT PRIMARY KEY, "recipeId" TEXT NOT NULL REFERENCES "TopicBuilderRecipe"("id") ON DELETE CASCADE,
 "workspaceId" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "progress" TEXT NOT NULL DEFAULT 'Queued',
 "fingerprint" TEXT NOT NULL, "sourceManifest" JSONB NOT NULL, "result" JSONB, "changes" JSONB, "error" TEXT,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "TopicBuilderRun_workspaceId_recipeId_createdAt_idx" ON "TopicBuilderRun"("workspaceId","recipeId","createdAt");
CREATE UNIQUE INDEX "TopicBuilderRun_one_active_recipe" ON "TopicBuilderRun"("recipeId") WHERE "status" IN ('queued','running');
CREATE TABLE "TopicBuilderScan" (
 "id" TEXT PRIMARY KEY, "recipeId" TEXT NOT NULL REFERENCES "TopicBuilderRecipe"("id") ON DELETE CASCADE,
 "fingerprint" TEXT NOT NULL, "evidence" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TopicBuilderScan_recipeId_fingerprint_key" ON "TopicBuilderScan"("recipeId","fingerprint");
