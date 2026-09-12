ALTER TABLE "Document"
ADD COLUMN "aircraftFamilyIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "applicabilityScope" TEXT,
ADD COLUMN "applicabilityConfidence" DOUBLE PRECISION,
ADD COLUMN "applicabilityEvidence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "applicabilityStatus" TEXT,
ADD COLUMN "applicabilityProvider" TEXT,
ADD COLUMN "applicabilityModel" TEXT,
ADD COLUMN "applicabilityClassifiedAt" TIMESTAMP(3),
ADD COLUMN "applicabilityOverrideBy" TEXT,
ADD COLUMN "applicabilityOverriddenAt" TIMESTAMP(3);
