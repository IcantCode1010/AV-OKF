ALTER TABLE "Document"
ADD COLUMN "aircraftTypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "sourceClassification" TEXT,
ADD COLUMN "licenseIdentifier" TEXT,
ADD COLUMN "intendedAudiences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "contentPurpose" TEXT;
