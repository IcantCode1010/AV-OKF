CREATE TABLE "KnowledgeResearchRun" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"userId" TEXT NOT NULL,"consumer" TEXT NOT NULL,"ownerId" TEXT,"status" TEXT NOT NULL DEFAULT 'queued',"progress" TEXT NOT NULL DEFAULT 'Queued',"scope" JSONB NOT NULL,"request" JSONB NOT NULL,"result" JSONB,"diagnostics" JSONB NOT NULL DEFAULT '{}',"policyVersion" TEXT NOT NULL,"model" TEXT,"cancelledAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "KnowledgeResearchRun_workspaceId_userId_status_idx" ON "KnowledgeResearchRun"("workspaceId","userId","status");
CREATE TABLE "KnowledgeArticle" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"collectionId" TEXT,"originKind" TEXT NOT NULL,"originId" TEXT NOT NULL,"approvedRevisionId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "KnowledgeArticle_workspaceId_originKind_originId_key" ON "KnowledgeArticle"("workspaceId","originKind","originId");
CREATE INDEX "KnowledgeArticle_workspaceId_collectionId_idx" ON "KnowledgeArticle"("workspaceId","collectionId");
CREATE TABLE "KnowledgeArticleRevision" ("id" TEXT PRIMARY KEY,"articleId" TEXT NOT NULL REFERENCES "KnowledgeArticle"("id"),"workspaceId" TEXT NOT NULL,"body" JSONB NOT NULL,"evidence" JSONB NOT NULL,"sourceFingerprint" TEXT NOT NULL,"policyVersion" TEXT NOT NULL,"approval" JSONB,"legacy" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "KnowledgeArticleRevision_workspaceId_articleId_createdAt_idx" ON "KnowledgeArticleRevision"("workspaceId","articleId","createdAt");
CREATE TABLE "KnowledgeVisual" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"articleRevisionId" TEXT NOT NULL,"kind" TEXT NOT NULL,"spec" JSONB NOT NULL,"provenance" JSONB NOT NULL,"caption" TEXT NOT NULL,"altText" TEXT NOT NULL,"reviewedBy" TEXT,"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "KnowledgeVisual_workspaceId_articleRevisionId_idx" ON "KnowledgeVisual"("workspaceId","articleRevisionId");
CREATE TABLE "KnowledgeEfbSelection" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"articleId" TEXT NOT NULL,"revisionId" TEXT NOT NULL,"metadata" JSONB NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "KnowledgeEfbSelection_workspaceId_articleId_key" ON "KnowledgeEfbSelection"("workspaceId","articleId");
CREATE TABLE "KnowledgeExportRelease" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'draft',"selectionSnapshot" JSONB NOT NULL,"result" JSONB,"error" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "KnowledgeExportRelease_workspaceId_createdAt_idx" ON "KnowledgeExportRelease"("workspaceId","createdAt");

ALTER TABLE "TopicBuilderRecipe" ADD COLUMN "researchMode" TEXT NOT NULL DEFAULT 'exhaustive';
ALTER TABLE "TopicBuilderRun" ADD COLUMN "recipeSnapshot" JSONB;
