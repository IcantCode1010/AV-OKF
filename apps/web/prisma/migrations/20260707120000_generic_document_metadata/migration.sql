-- Rename aviation-specific document metadata columns to domain-neutral names.
ALTER TABLE "Document" RENAME COLUMN "aircraftFamily" TO "subjectFamily";
ALTER TABLE "Document" RENAME COLUMN "manualType" TO "documentType";
ALTER TABLE "Document" RENAME COLUMN "ata" TO "classificationCode";
