ALTER TABLE "BulkTopicApprovalRun"
ADD COLUMN "selectionFingerprint" TEXT;

CREATE UNIQUE INDEX "BulkTopicApprovalRun_selectionFingerprint_key"
ON "BulkTopicApprovalRun"("selectionFingerprint");
