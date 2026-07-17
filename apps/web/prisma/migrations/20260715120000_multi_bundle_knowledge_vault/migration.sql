-- Establish one General Knowledge bundle per existing workspace, then make all
-- bundle-owned records explicit. Filesystem movement is handled by the
-- resumable application migration because PostgreSQL cannot move the bundle.

CREATE TABLE "KnowledgeBundle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "activeProfileVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeBundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeBundleProfileVersion" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "templateId" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeBundleProfileVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OkfRelationCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "targetFile" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OkfRelationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BundleDeletionAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "bundleName" TEXT NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletionCounts" JSONB NOT NULL,
    CONSTRAINT "BundleDeletionAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Document" ADD COLUMN "knowledgeBundleId" TEXT;
ALTER TABLE "TopicRecord" ADD COLUMN "knowledgeBundleId" TEXT;
ALTER TABLE "TopicRecord" ADD COLUMN "okfMetadata" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "OkfConceptLifecycle" ADD COLUMN "knowledgeBundleId" TEXT;
ALTER TABLE "OkfConceptChunkLink" ADD COLUMN "knowledgeBundleId" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "knowledgeBundleId" TEXT;

INSERT INTO "KnowledgeBundle" (
    "id", "workspaceId", "name", "slug", "description", "status", "createdBy"
)
SELECT
    'kb_' || md5(w."id"),
    w."id",
    'General Knowledge',
    'general',
    'Migrated general-purpose knowledge bundle.',
    'active',
    COALESCE((
        SELECT wm."userId"
        FROM "WorkspaceMember" wm
        WHERE wm."workspaceId" = w."id"
        ORDER BY CASE WHEN wm."role" = 'admin' THEN 0 ELSE 1 END, wm."createdAt"
        LIMIT 1
    ), 'system_migration')
FROM "Workspace" w;

INSERT INTO "KnowledgeBundleProfileVersion" (
    "id", "bundleId", "version", "status", "templateId", "schema", "createdBy", "activatedAt"
)
SELECT
    'kbpv_' || md5(kb."id" || ':1'),
    kb."id",
    1,
    'active',
    'generic',
    '{"id":"generic","name":"Generic","fields":{"type":{"type":"string","required":true},"title":{"type":"string"},"description":{"type":"string"},"tags":{"type":"string_array"},"updated":{"type":"date"}},"types":{"system_topic":{"label":"System topic","category":"concepts"},"concept":{"label":"Concept","category":"concepts"},"policy":{"label":"Policy","category":"concepts"},"procedure":{"label":"Procedure","category":"procedures"},"system":{"label":"System","category":"concepts"},"metric":{"label":"Metric","category":"references"},"reference":{"label":"Reference","category":"references"}},"relations":["routes_to","references","supports","covered_by","supersedes","conflicts_with","depends_on"]}'::jsonb,
    kb."createdBy",
    CURRENT_TIMESTAMP
FROM "KnowledgeBundle" kb;

UPDATE "KnowledgeBundle" kb
SET "activeProfileVersionId" = pv."id"
FROM "KnowledgeBundleProfileVersion" pv
WHERE pv."bundleId" = kb."id" AND pv."version" = 1;

UPDATE "Document" d SET "knowledgeBundleId" = kb."id"
FROM "KnowledgeBundle" kb WHERE kb."workspaceId" = d."workspaceId";
UPDATE "TopicRecord" t SET "knowledgeBundleId" = kb."id"
FROM "KnowledgeBundle" kb WHERE kb."workspaceId" = t."workspaceId";
UPDATE "OkfConceptLifecycle" l SET "knowledgeBundleId" = kb."id"
FROM "KnowledgeBundle" kb WHERE kb."workspaceId" = l."workspaceId";
UPDATE "OkfConceptChunkLink" c SET "knowledgeBundleId" = kb."id"
FROM "KnowledgeBundle" kb WHERE kb."workspaceId" = c."workspaceId";
UPDATE "ChatSession" c SET "knowledgeBundleId" = kb."id"
FROM "KnowledgeBundle" kb WHERE kb."workspaceId" = c."workspaceId";

ALTER TABLE "Document" ALTER COLUMN "knowledgeBundleId" SET NOT NULL;
ALTER TABLE "TopicRecord" ALTER COLUMN "knowledgeBundleId" SET NOT NULL;
ALTER TABLE "OkfConceptLifecycle" ALTER COLUMN "knowledgeBundleId" SET NOT NULL;
ALTER TABLE "OkfConceptChunkLink" ALTER COLUMN "knowledgeBundleId" SET NOT NULL;
ALTER TABLE "ChatSession" ALTER COLUMN "knowledgeBundleId" SET NOT NULL;

DROP INDEX IF EXISTS "OkfConceptLifecycle_workspaceId_filePath_key";
DROP INDEX IF EXISTS "OkfConceptChunkLink_workspaceId_okfConceptId_chunkId_key";

CREATE UNIQUE INDEX "KnowledgeBundle_workspaceId_slug_key" ON "KnowledgeBundle"("workspaceId", "slug");
CREATE UNIQUE INDEX "KnowledgeBundle_activeProfileVersionId_key" ON "KnowledgeBundle"("activeProfileVersionId");
CREATE INDEX "KnowledgeBundle_workspaceId_status_idx" ON "KnowledgeBundle"("workspaceId", "status");
CREATE UNIQUE INDEX "KnowledgeBundleProfileVersion_bundleId_version_key" ON "KnowledgeBundleProfileVersion"("bundleId", "version");
CREATE INDEX "KnowledgeBundleProfileVersion_bundleId_status_idx" ON "KnowledgeBundleProfileVersion"("bundleId", "status");
CREATE UNIQUE INDEX "OkfRelationCandidate_knowledgeBundleId_sourceFile_targetFile_relation_key" ON "OkfRelationCandidate"("knowledgeBundleId", "sourceFile", "targetFile", "relation");
CREATE INDEX "OkfRelationCandidate_workspaceId_knowledgeBundleId_status_idx" ON "OkfRelationCandidate"("workspaceId", "knowledgeBundleId", "status");
CREATE INDEX "BundleDeletionAudit_workspaceId_deletedAt_idx" ON "BundleDeletionAudit"("workspaceId", "deletedAt");
CREATE INDEX "Document_knowledgeBundleId_updatedAt_idx" ON "Document"("knowledgeBundleId", "updatedAt");
CREATE INDEX "TopicRecord_knowledgeBundleId_documentId_idx" ON "TopicRecord"("knowledgeBundleId", "documentId");
CREATE INDEX "ChatSession_knowledgeBundleId_updatedAt_idx" ON "ChatSession"("knowledgeBundleId", "updatedAt");
CREATE UNIQUE INDEX "OkfConceptLifecycle_knowledgeBundleId_filePath_key" ON "OkfConceptLifecycle"("knowledgeBundleId", "filePath");
CREATE UNIQUE INDEX "OkfConceptChunkLink_knowledgeBundleId_okfConceptId_chunkId_key" ON "OkfConceptChunkLink"("knowledgeBundleId", "okfConceptId", "chunkId");

ALTER TABLE "KnowledgeBundle" ADD CONSTRAINT "KnowledgeBundle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeBundleProfileVersion" ADD CONSTRAINT "KnowledgeBundleProfileVersion_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeBundle" ADD CONSTRAINT "KnowledgeBundle_activeProfileVersionId_fkey" FOREIGN KEY ("activeProfileVersionId") REFERENCES "KnowledgeBundleProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicRecord" ADD CONSTRAINT "TopicRecord_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfConceptLifecycle" ADD CONSTRAINT "OkfConceptLifecycle_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfConceptChunkLink" ADD CONSTRAINT "OkfConceptChunkLink_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OkfRelationCandidate" ADD CONSTRAINT "OkfRelationCandidate_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BundleDeletionAudit" ADD CONSTRAINT "BundleDeletionAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
