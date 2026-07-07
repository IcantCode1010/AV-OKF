-- Add an explicit foreign key so deleting a RagChunk cascades derived OKF coverage projections.
DELETE FROM "OkfConceptChunkLink" link
WHERE NOT EXISTS (
  SELECT 1 FROM "RagChunk" chunk WHERE chunk.id = link."chunkId"
);

ALTER TABLE "OkfConceptChunkLink"
ADD CONSTRAINT "OkfConceptChunkLink_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "RagChunk"("id")
ON DELETE CASCADE ON UPDATE CASCADE;