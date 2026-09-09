ALTER TABLE "Document"
  ADD COLUMN "maintenanceAtaChapterIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "pilotQrhTargetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
