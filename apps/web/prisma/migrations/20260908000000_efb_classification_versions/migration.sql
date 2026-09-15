ALTER TABLE "KnowledgeArticleRevision" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "parentRevisionId" TEXT, ADD COLUMN "changeReason" TEXT NOT NULL DEFAULT 'Generated article';
WITH numbered AS (
 SELECT id, ROW_NUMBER() OVER (PARTITION BY "articleId" ORDER BY "createdAt", id) AS n,
 LAG(id) OVER (PARTITION BY "articleId" ORDER BY "createdAt", id) AS parent
 FROM "KnowledgeArticleRevision"
) UPDATE "KnowledgeArticleRevision" r SET "version" = numbered.n,
 "parentRevisionId" = numbered.parent FROM numbered WHERE numbered.id = r.id;
CREATE UNIQUE INDEX "KnowledgeArticleRevision_articleId_version_key" ON "KnowledgeArticleRevision"("articleId", "version");
-- Serialize allocation per article, including imports and concurrent edits.
CREATE FUNCTION allocate_article_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "KnowledgeArticle" WHERE id = NEW."articleId" FOR UPDATE;
 SELECT COALESCE(MAX("version"), 0) + 1 INTO NEW."version" FROM "KnowledgeArticleRevision" WHERE "articleId" = NEW."articleId";
 RETURN NEW;
END;
$$;
CREATE TRIGGER article_version_before_insert BEFORE INSERT ON "KnowledgeArticleRevision" FOR EACH ROW EXECUTE FUNCTION allocate_article_version();
CREATE TABLE "KnowledgeEfbRegistrySnapshot" (
 "hash" TEXT PRIMARY KEY, "schemaVersion" TEXT NOT NULL, "body" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "KnowledgeEfbClassification" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "revisionId" TEXT NOT NULL REFERENCES "KnowledgeArticleRevision"(id),
 "registryHash" TEXT NOT NULL REFERENCES "KnowledgeEfbRegistrySnapshot"(hash), "policyVersion" TEXT NOT NULL,
 "result" JSONB NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "KnowledgeEfbClassification_revisionId_registryHash_policyVersion_key" ON "KnowledgeEfbClassification"("revisionId", "registryHash", "policyVersion");
CREATE INDEX "KnowledgeEfbClassification_workspaceId_status_idx" ON "KnowledgeEfbClassification"("workspaceId", "status");
CREATE TABLE "KnowledgeEfbClassificationDecision" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "classificationId" TEXT NOT NULL REFERENCES "KnowledgeEfbClassification"(id),
 "previous" JSONB NOT NULL, "result" JSONB NOT NULL, "reason" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "KnowledgeEfbClassificationDecision_workspaceId_classificationId_idx" ON "KnowledgeEfbClassificationDecision"("workspaceId", "classificationId");
