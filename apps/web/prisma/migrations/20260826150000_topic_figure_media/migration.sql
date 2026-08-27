ALTER TABLE "ExtractedPage"
ADD COLUMN "visualCandidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "figureCaptionHints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "DocumentMediaAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT,
    "documentId" TEXT NOT NULL,
    "extractedPageId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "boundingBox" JSONB NOT NULL,
    "sourceCaption" TEXT,
    "altText" TEXT NOT NULL,
    "visualContext" TEXT NOT NULL,
    "visibleLabels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ocrText" TEXT,
    "contentSha256" TEXT NOT NULL,
    "sourceDocumentSha256" TEXT,
    "analysisProvider" TEXT,
    "analysisModel" TEXT,
    "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicMediaReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "anchorTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicMediaReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAnalysisAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "extractedPageId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "structuredOutput" JSONB,
    "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "succeeded" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAnalysisAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentMediaAsset_objectKey_key" ON "DocumentMediaAsset"("objectKey");
CREATE INDEX "DocumentMediaAsset_workspaceId_documentId_pageNumber_idx" ON "DocumentMediaAsset"("workspaceId", "documentId", "pageNumber");
CREATE INDEX "DocumentMediaAsset_knowledgeBundleId_createdAt_idx" ON "DocumentMediaAsset"("knowledgeBundleId", "createdAt");
CREATE INDEX "DocumentMediaAsset_contentSha256_idx" ON "DocumentMediaAsset"("contentSha256");
CREATE UNIQUE INDEX "TopicMediaReference_topicId_mediaAssetId_key" ON "TopicMediaReference"("topicId", "mediaAssetId");
CREATE INDEX "TopicMediaReference_workspaceId_documentId_status_idx" ON "TopicMediaReference"("workspaceId", "documentId", "status");
CREATE INDEX "TopicMediaReference_knowledgeBundleId_topicId_status_idx" ON "TopicMediaReference"("knowledgeBundleId", "topicId", "status");
CREATE INDEX "TopicMediaReference_mediaAssetId_status_idx" ON "TopicMediaReference"("mediaAssetId", "status");
CREATE INDEX "MediaAnalysisAudit_workspaceId_documentId_createdAt_idx" ON "MediaAnalysisAudit"("workspaceId", "documentId", "createdAt");
CREATE INDEX "MediaAnalysisAudit_documentId_pageNumber_idx" ON "MediaAnalysisAudit"("documentId", "pageNumber");

ALTER TABLE "DocumentMediaAsset" ADD CONSTRAINT "DocumentMediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentMediaAsset" ADD CONSTRAINT "DocumentMediaAsset_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentMediaAsset" ADD CONSTRAINT "DocumentMediaAsset_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentMediaAsset" ADD CONSTRAINT "DocumentMediaAsset_extractedPageId_fkey" FOREIGN KEY ("extractedPageId") REFERENCES "ExtractedPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopicMediaReference" ADD CONSTRAINT "TopicMediaReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicMediaReference" ADD CONSTRAINT "TopicMediaReference_knowledgeBundleId_fkey" FOREIGN KEY ("knowledgeBundleId") REFERENCES "KnowledgeBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicMediaReference" ADD CONSTRAINT "TopicMediaReference_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicMediaReference" ADD CONSTRAINT "TopicMediaReference_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicMediaReference" ADD CONSTRAINT "TopicMediaReference_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "DocumentMediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAnalysisAudit" ADD CONSTRAINT "MediaAnalysisAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAnalysisAudit" ADD CONSTRAINT "MediaAnalysisAudit_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAnalysisAudit" ADD CONSTRAINT "MediaAnalysisAudit_extractedPageId_fkey" FOREIGN KEY ("extractedPageId") REFERENCES "ExtractedPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
