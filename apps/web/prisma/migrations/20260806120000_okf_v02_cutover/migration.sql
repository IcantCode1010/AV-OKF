ALTER TABLE "Document" ADD COLUMN "contentSha256" TEXT;
ALTER TABLE "KnowledgeBundle" ADD COLUMN "okfVersion" TEXT NOT NULL DEFAULT '0.1';

CREATE INDEX "Document_contentSha256_idx" ON "Document"("contentSha256");
