import { createHash } from "node:crypto";

export type EfbReviewPacketConfig = {
  schemaVersion: "1.0";
  documentId: string;
  candidates: Array<{
    topicId: string;
    entryId: string;
    proposedTitle: string;
    displayOrder: number;
  }>;
};

type VaultDocument = {
  id: string;
  title: string;
  originalFilename?: string | null;
  aircraftFamily?: string | null;
  ata?: string | null;
  effectivity?: string | null;
  sourceAuthority?: string | null;
  revision?: string | null;
  extraction?: {
    status?: string;
    pageRecords?: Array<{ pageNumber: number; text: string }>;
  } | null;
};

type VaultTopic = {
  id: string;
  documentId: string;
  title: string;
  reviewStatus: string;
  sourcePageNumbers: number[];
};

export function buildEfbReviewPacket(input: {
  config: EfbReviewPacketConfig;
  createdAt: string;
  vault: { documents: VaultDocument[]; topicRecords: VaultTopic[] };
}) {
  if (input.config.schemaVersion !== "1.0") {
    throw new Error("efb_review_packet_config_version_invalid");
  }
  if (Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("efb_review_packet_created_at_invalid");
  }
  const document = input.vault.documents.find(
    (candidate) => candidate.id === input.config.documentId,
  );
  if (!document) throw new Error("efb_review_packet_document_not_found");
  if (document.extraction?.status !== "completed") {
    throw new Error("efb_review_packet_extraction_incomplete");
  }
  const pageRecords = document.extraction.pageRecords ?? [];
  const pagesByNumber = new Map(pageRecords.map((page) => [page.pageNumber, page]));
  const coverText = pagesByNumber.get(1)?.text ?? "";
  const allSelectedText = input.config.candidates.flatMap((candidate) => {
    const topic = input.vault.topicRecords.find((item) => item.id === candidate.topicId);
    return topic?.sourcePageNumbers.map((page) => pagesByNumber.get(page)?.text ?? "") ?? [];
  }).join("\n");
  const extractedIdentity = inferSourceIdentity(`${coverText}\n${allSelectedText}`);
  const metadataIssues = findMetadataIssues(document, extractedIdentity);
  const seenEntryIds = new Set<string>();
  const candidates = input.config.candidates.map((candidate) => {
    if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(candidate.entryId)) {
      throw new Error(`efb_review_packet_entry_id_invalid:${candidate.entryId}`);
    }
    if (seenEntryIds.has(candidate.entryId)) {
      throw new Error(`efb_review_packet_entry_id_duplicate:${candidate.entryId}`);
    }
    seenEntryIds.add(candidate.entryId);
    const topic = input.vault.topicRecords.find((item) => item.id === candidate.topicId);
    if (!topic || topic.documentId !== document.id) {
      throw new Error(`efb_review_packet_topic_not_found:${candidate.topicId}`);
    }
    if (topic.reviewStatus === "rejected") {
      throw new Error(`efb_review_packet_topic_rejected:${candidate.topicId}`);
    }
    const evidence = topic.sourcePageNumbers.map((pageNumber) => {
      const page = pagesByNumber.get(pageNumber);
      if (!page?.text.trim()) {
        throw new Error(`efb_review_packet_source_page_missing:${candidate.topicId}:${pageNumber}`);
      }
      return {
        pageNumber,
        text: page.text,
        sha256: sha256(page.text),
      };
    });
    return {
      topicId: topic.id,
      entryId: candidate.entryId,
      proposedTitle: candidate.proposedTitle,
      currentTopicTitle: topic.title,
      currentReviewStatus: topic.reviewStatus,
      status: "requires-human-review" as const,
      sourceEvidence: evidence,
      proposedEfbMetadata: {
        audiences: ["maintenance"],
        aircraftTypeIds: ["b738"],
        placements: [
          `ata:${extractedIdentity.ata ?? "UNRESOLVED"}:${candidate.displayOrder}`,
          `quick-access:maintenance:${candidate.displayOrder}`,
        ],
        sourceClassification: extractedIdentity.sourceClassification,
        authorityLabel: "Training reference — not approved maintenance instructions",
        licenseIdentifier: null,
        licenseReviewedBy: null,
        licenseReviewedAt: null,
        verifiedBy: null,
        verifiedAt: null,
      },
      blockers: [
        "complete_display_body_required",
        "technical_review_required",
        "license_review_required",
        ...(metadataIssues.length > 0 ? ["source_metadata_correction_required"] : []),
      ],
      reviewChecklist: {
        sourceCompared: false,
        extractionErrorsCorrected: false,
        applicabilityConfirmed: false,
        authorityConfirmed: false,
        licenseConfirmed: false,
        displayBodyApproved: false,
      },
    };
  });

  return {
    schemaVersion: "1.0",
    status: "requires-human-review" as const,
    createdAt: input.createdAt,
    sourceDocument: {
      id: document.id,
      title: document.title,
      originalFilename: document.originalFilename ?? null,
      currentMetadata: {
        aircraftFamily: document.aircraftFamily ?? null,
        ata: document.ata ?? null,
        effectivity: document.effectivity ?? null,
        sourceAuthority: document.sourceAuthority ?? null,
        revision: document.revision ?? null,
      },
      extractedIdentity,
      metadataIssues,
    },
    candidates,
  };
}

function inferSourceIdentity(text: string) {
  const ata = /\b(\d{2})-\d{2}-\d{2}\b/.exec(text)?.[1] ?? null;
  const revision = /\bRevision\s+([^\r\n]+)/i.exec(text)?.[1]?.trim() ?? null;
  const aircraftFamily = /\b737\s*NG\b/i.test(text)
    ? "Boeing 737NG"
    : /\bA320(?:-251N)?\b/i.test(text)
      ? "Airbus A320"
      : null;
  const sourceClassification = /UNCONTROLLED DOCUMENT[\s\S]*Training\s+Purposes\s+Only/i.test(text)
    ? "training-reference"
    : "unresolved";
  return { aircraftFamily, ata, revision, sourceClassification };
}

function findMetadataIssues(
  document: VaultDocument,
  extracted: ReturnType<typeof inferSourceIdentity>,
): string[] {
  const issues: string[] = [];
  if (extracted.ata && normalizeAta(document.ata) !== extracted.ata) {
    issues.push(`ata_conflict:${document.ata ?? "missing"}:${extracted.ata}`);
  }
  if (
    extracted.aircraftFamily &&
    document.aircraftFamily?.trim().toLowerCase() !== extracted.aircraftFamily.toLowerCase()
  ) {
    issues.push(`aircraft_family_conflict:${document.aircraftFamily ?? "missing"}:${extracted.aircraftFamily}`);
  }
  if (
    extracted.sourceClassification === "training-reference" &&
    /maintenance\s+manual|flight\s+manual|approved\s+data/i.test(document.sourceAuthority ?? "")
  ) {
    issues.push(`source_authority_conflict:${document.sourceAuthority}`);
  }
  if (extracted.revision && document.revision?.trim() !== extracted.revision) {
    issues.push(`revision_conflict:${document.revision ?? "missing"}:${extracted.revision}`);
  }
  if (extracted.ata === "24" && /landing\s+gear|\b32\b/i.test(document.title)) {
    issues.push(`document_title_conflict:${document.title}:ATA 24`);
  }
  return issues;
}

function normalizeAta(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.replace(/^ATA[\s-]*/i, "").padStart(2, "0");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
