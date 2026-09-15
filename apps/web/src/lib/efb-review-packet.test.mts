import assert from "node:assert/strict";
import test from "node:test";

import { buildEfbReviewPacket } from "./efb-review-packet.ts";

test("builds a non-approving review packet with exact page evidence and metadata conflicts", () => {
  const packet = buildEfbReviewPacket({
    config: {
      schemaVersion: "1.0",
      documentId: "doc-1",
      candidates: [{
        topicId: "topic-1",
        entryId: "b738-ata24-electrical-overview",
        proposedTitle: "Electrical Power System Overview",
        displayOrder: 10,
      }],
    },
    createdAt: "2026-09-03T15:00:00Z",
    vault: {
      documents: [{
        id: "doc-1",
        title: "737NG AMM 32 Landing Gear",
        originalFilename: "03 Electrical Power.pdf",
        aircraftFamily: "Boeing 737NG",
        ata: "32",
        effectivity: "737-700/800/900",
        sourceAuthority: "Boeing Aircraft Maintenance Manual",
        revision: "2026-06",
        extraction: {
          status: "completed",
          pageRecords: [
            {
              pageNumber: 1,
              text: "Airbus Maintenance Training\nBoeing 737\nUNCONTROLLED DOCUMENT\nFor Training Purposes Only\nRevision 2.0.0-20231128",
            },
            {
              pageNumber: 2,
              text: "ELECTRICAL POWER - INTRODUCTION\nEffective On: 24-00-00\n737 NG\nComplete source evidence.",
            },
          ],
        },
      }],
      topicRecords: [{
        id: "topic-1",
        documentId: "doc-1",
        title: "ELECTRICAL POWER - INTRODUCTION",
        reviewStatus: "approved",
        sourcePageNumbers: [2],
      }],
    },
  });

  assert.equal(packet.status, "requires-human-review");
  assert.equal(packet.sourceDocument.extractedIdentity.ata, "24");
  assert.equal(packet.sourceDocument.extractedIdentity.sourceClassification, "training-reference");
  assert(packet.sourceDocument.metadataIssues.some((issue) => issue.startsWith("ata_conflict:")));
  assert(packet.sourceDocument.metadataIssues.some((issue) => issue.startsWith("source_authority_conflict:")));
  assert.equal(packet.candidates[0]!.proposedEfbMetadata.licenseIdentifier, null);
  assert.equal(packet.candidates[0]!.reviewChecklist.sourceCompared, false);
  assert.match(packet.candidates[0]!.sourceEvidence[0]!.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(packet.candidates[0]!.blockers, [
    "complete_display_body_required",
    "technical_review_required",
    "license_review_required",
    "source_metadata_correction_required",
  ]);
});

test("rejects missing evidence pages and rejected topics", () => {
  const base = {
    config: {
      schemaVersion: "1.0" as const,
      documentId: "doc-1",
      candidates: [{ topicId: "topic-1", entryId: "entry-1", proposedTitle: "Candidate", displayOrder: 10 }],
    },
    createdAt: "2026-09-03T15:00:00Z",
    vault: {
      documents: [{
        id: "doc-1",
        title: "Source",
        extraction: { status: "completed", pageRecords: [] },
      }],
      topicRecords: [{
        id: "topic-1",
        documentId: "doc-1",
        title: "Candidate",
        reviewStatus: "needs_review",
        sourcePageNumbers: [2],
      }],
    },
  };
  assert.throws(() => buildEfbReviewPacket(base), /source_page_missing/);
  base.vault.topicRecords[0]!.reviewStatus = "rejected";
  assert.throws(() => buildEfbReviewPacket(base), /topic_rejected/);
});
