import type {
  Document,
  ExtractionStatus,
  TopicDiscoveryStatus,
} from "./document-vault.ts";
import type { DocumentBatchProgress } from "./document-batch-progress.ts";

export type DocumentProcessingStageId =
  | "upload"
  | "inspection"
  | "extraction"
  | "metadata_discovery"
  | "concept_discovery"
  | "media_discovery"
  | "full_rag_index"
  | "enrichment"
  | "entity_connections"
  | "relation_classification"
  | "validation"
  | "review_export";

export type DocumentProcessingStageStatus =
  | "waiting"
  | "queued"
  | "running"
  | "completed"
  | "action_required"
  | "failed"
  | "skipped";

export type DocumentProcessingStage = {
  detail: string;
  id: DocumentProcessingStageId;
  label: string;
  status: DocumentProcessingStageStatus;
};

export type ProcessingAuthoringRun = {
  automaticApprovalRun: {
    id: string;
    items?: Array<{ status: string }>;
    knowledgeBundleId: string;
    status: string;
  } | null;
  automaticTopicApprovalEnabled: boolean;
  completedStages: string[];
  currentStage: string;
  errorMessage: string | null;
  id: string;
  status: string;
};

export type DocumentProcessingState = {
  active: boolean;
  automaticApprovalEnabled: boolean;
  bundleName: string;
  currentDetail: string;
  currentLabel: string;
  headerTone: "active" | "attention" | "failed" | "success";
  showHeader: boolean;
  stages: DocumentProcessingStage[];
  terminal: boolean;
};

export type DocumentProcessingFingerprintSnapshot = {
  authoring: {
    completedStages: string[];
    currentStage: string;
    errorMessage: string | null;
    id: string;
    status: string;
  } | null;
  automaticApproval: {
    id: string;
    itemStatuses: string[];
    status: string;
  } | null;
  entityConnections?: {
    completed: number;
    failed: number;
    queued: number;
    running: number;
  } | null;
  extraction: {
    completedBatches?: number;
    errorCode: string | null;
    inspectionStatus?: string;
    ocrPageCount?: number;
    pageCount: number;
    status: string;
    totalBatches?: number;
  };
  ragIndex?: { completedBatches: number; status: string; totalBatches: number } | null;
  topicDiscovery: {
    completedWindows: number;
    errorMessage: string | null;
    status: string;
    totalWindows: number;
  } | null;
};

const authoringStageIds: DocumentProcessingStageId[] = [
  "metadata_discovery",
  "concept_discovery",
  "media_discovery",
  "full_rag_index",
  "enrichment",
  "relation_classification",
  "validation",
];

export const DOCUMENT_DETAIL_PANELS = [
  "processing",
  "summary",
  "metadata",
  "extraction",
  "authoring",
  "topics",
  "logs",
] as const;

export type DocumentDetailPanel = (typeof DOCUMENT_DETAIL_PANELS)[number];

const stageCopy: Record<
  DocumentProcessingStageId,
  { detail: string; label: string }
> = {
  upload: {
    detail: "The source PDF is stored securely in its assigned knowledge bundle.",
    label: "PDF uploaded",
  },
  inspection: {
    detail: "Checking PDF integrity, encryption, page count, and which pages require OCR.",
    label: "PDF inspection",
  },
  extraction: {
    detail: "Reading the PDF and creating page-level source records.",
    label: "Text extraction",
  },
  metadata_discovery: {
    detail: "Identifying useful document metadata from the extracted source.",
    label: "Metadata discovery",
  },
  concept_discovery: {
    detail: "Finding and consolidating the concepts discussed in the document.",
    label: "Concept discovery",
  },
  media_discovery: {
    detail: "Extracting source-grounded figure crops and associating them with exact-page topics for review.",
    label: "Figure discovery",
  },
  full_rag_index: {
    detail: "Building a complete, inactive search index across every readable nonblank page.",
    label: "Full-document search index",
  },
  enrichment: {
    detail: "Preparing grounded titles, summaries, and article content for review.",
    label: "Topic enrichment",
  },
  entity_connections: {
    detail: "Extracting grounded entities and explicit connection evidence in bounded background jobs.",
    label: "Entities and connections",
  },
  relation_classification: {
    detail: "Finding explicit relationships between this document's concepts and verifying them against source evidence.",
    label: "Local relation discovery",
  },
  validation: {
    detail: "Checking source coverage, metadata readiness, and review requirements.",
    label: "Validation",
  },
  review_export: {
    detail: "Preparing reviewed knowledge for approval and bundle export.",
    label: "Review and export",
  },
};

export function buildDocumentProcessingState(input: {
  authoringRun: ProcessingAuthoringRun | null;
  bundleName: string;
  document: Pick<Document, "extraction" | "storageKey" | "topicDiscovery">;
  extractionProgress?: DocumentBatchProgress | null;
  entityConnections?: { completed: number; failed: number; queued: number; running: number } | null;
  reviewTopicCount?: number;
  topicCount: number;
}): DocumentProcessingState {
  const stages = initializeStages();
  stages[0] = stage("upload", input.document.storageKey ? "completed" : "skipped");
  stages[1] = stage("inspection", inspectionStageStatus(input.document.extraction.status, input.extractionProgress));
  stages[2] = stage("extraction", extractionStageStatus(input.document.extraction.status),
    extractionDetail(input.document.extraction.status, input.extractionProgress));

  const run = input.authoringRun;
  if (input.document.extraction.status === "failed") {
    return finish(stages, false, false, input.bundleName);
  }
  if (input.document.extraction.status !== "completed") {
    return finish(stages, false, false, input.bundleName);
  }
  if (!run) {
    stages[stageIndex("metadata_discovery")] = stage(
      "metadata_discovery",
      "action_required",
      "Extraction is complete. Start AI-assisted authoring when you are ready.",
    );
    return finish(stages, false, false, input.bundleName);
  }

  for (const id of authoringStageIds) {
    stages[stageIndex(id)] = deriveAuthoringStage(id, run, input.document.topicDiscovery);
  }
  stages[stageIndex("entity_connections")] = deriveEntityConnectionStage(run, input.entityConnections, input.topicCount);
  stages[stageIndex("review_export")] = deriveReviewStage(run, input.reviewTopicCount ?? input.topicCount);

  return finish(stages, run.automaticTopicApprovalEnabled, true, input.bundleName);
}

export function resolveDocumentPanel(input: {
  extractionStatus: ExtractionStatus;
  processingState: DocumentProcessingState;
  requestedPanel?: string;
  topicCount: number;
}): DocumentDetailPanel {
  if (
    input.requestedPanel &&
    DOCUMENT_DETAIL_PANELS.includes(input.requestedPanel as DocumentDetailPanel)
  ) {
    return input.requestedPanel as DocumentDetailPanel;
  }

  if (input.processingState.showHeader) return "processing";
  if (input.topicCount > 0 || input.extractionStatus === "completed") return "topics";
  return "summary";
}

export function shouldPollDocumentProcessing(input: {
  authoringStatus?: string;
  automaticApprovalStatus?: string;
  derivedProcessingActive?: boolean;
  extractionStatus: ExtractionStatus;
  entityConnectionsActive?: boolean;
  topicDiscoveryStatus?: TopicDiscoveryStatus;
}) {
  return (
    input.derivedProcessingActive === true ||
    input.entityConnectionsActive === true ||
    isActiveExtractionStatus(input.extractionStatus) ||
    isActiveDiscoveryStatus(input.topicDiscoveryStatus ?? "not_started") ||
    ["queued", "running"].includes(input.authoringStatus ?? "") ||
    ["queued", "running"].includes(input.automaticApprovalStatus ?? "")
  );
}

export function buildDocumentProcessingFingerprint(input: {
  authoringRun: ProcessingAuthoringRun | null;
  document: Pick<Document, "extraction" | "topicDiscovery">;
  entityConnections?: { completed: number; failed: number; queued: number; running: number } | null;
}) {
  const automaticRun = input.authoringRun?.automaticApprovalRun;
  return serializeDocumentProcessingFingerprint({
    authoring: input.authoringRun
      ? {
          completedStages: input.authoringRun.completedStages,
          currentStage: input.authoringRun.currentStage,
          errorMessage: input.authoringRun.errorMessage,
          id: input.authoringRun.id,
          status: input.authoringRun.status,
        }
      : null,
    automaticApproval: automaticRun
      ? {
          id: automaticRun.id,
          itemStatuses: (automaticRun.items ?? []).map((item) => item.status).sort(),
          status: automaticRun.status,
        }
      : null,
    ...(input.entityConnections ? { entityConnections: input.entityConnections } : {}),
    extraction: {
      errorCode: input.document.extraction.error?.code ?? null,
      pageCount: input.document.extraction.pageRecords.length,
      status: input.document.extraction.status,
    },
    topicDiscovery: input.document.topicDiscovery
      ? {
          completedWindows: input.document.topicDiscovery.completedWindows,
          errorMessage: input.document.topicDiscovery.errorMessage,
          status: input.document.topicDiscovery.status,
          totalWindows: input.document.topicDiscovery.totalWindows,
        }
      : null,
  });
}

function deriveEntityConnectionStage(
  run: ProcessingAuthoringRun,
  status: { completed: number; failed: number; queued: number; running: number } | null | undefined,
  topicCount: number,
) {
  if (!run.completedStages.includes("enrichment")) return stage("entity_connections", "waiting");
  if (!status) {
    return topicCount > 0 && !["ready_for_review", "completed"].includes(run.status)
      ? stage("entity_connections", "queued", "Grounded entity extraction will continue in the background.")
      : stage("entity_connections", "skipped", topicCount > 0 ? "No entity extraction job was recorded for this run." : "No enriched topics are available for entity extraction.");
  }
  if (status.running > 0) return stage("entity_connections", "running", `${status.running} topic extraction ${status.running === 1 ? "job is" : "jobs are"} running.`);
  if (status.queued > 0) return stage("entity_connections", "queued", `${status.queued} topic extraction ${status.queued === 1 ? "job is" : "jobs are"} queued.`);
  if (status.failed > 0) return stage("entity_connections", "action_required", `${status.completed} completed; ${status.failed} require retry. Topic review and export remain available.`);
  return stage("entity_connections", "completed", `${status.completed} grounded entity extraction ${status.completed === 1 ? "job is" : "jobs are"} complete.`);
}

export function resolveDocumentProcessingFingerprint(input: {
  authoringRun: ProcessingAuthoringRun | null;
  document: Pick<Document, "extraction" | "topicDiscovery">;
  productionSnapshot?: { fingerprint: string } | null;
}) {
  return input.productionSnapshot?.fingerprint
    ?? buildDocumentProcessingFingerprint(input);
}

export function serializeDocumentProcessingFingerprint(
  snapshot: DocumentProcessingFingerprintSnapshot,
) {
  return JSON.stringify({
    ...snapshot,
    automaticApproval: snapshot.automaticApproval
      ? {
          ...snapshot.automaticApproval,
          itemStatuses: [...snapshot.automaticApproval.itemStatuses].sort(),
        }
      : null,
  });
}

export function isDocumentProcessingInFlight(state: DocumentProcessingState) {
  return state.active;
}

function initializeStages() {
  return (Object.keys(stageCopy) as DocumentProcessingStageId[]).map((id) =>
    stage(id, "waiting"),
  );
}

function deriveAuthoringStage(
  id: DocumentProcessingStageId,
  run: ProcessingAuthoringRun,
  discovery: Document["topicDiscovery"],
): DocumentProcessingStage {
  if (run.completedStages.includes(id)) {
    return stage(id, "completed", id === "concept_discovery" ? discoveryProgress(discovery) : undefined);
  }

  if (run.currentStage !== id) return stage(id, "waiting");
  if (run.status === "failed") {
    return stage(id, "failed", run.errorMessage ?? `${stageCopy[id].label} failed.`);
  }
  if (run.status === "awaiting_provider") {
    return stage(id, "action_required", "Configure an AI provider before this workflow can continue.");
  }
  if (run.status === "awaiting_cost_confirmation") {
    return stage(id, "action_required", "Review the estimated authoring cost before enrichment continues.");
  }

  const status = run.status === "queued" ? "queued" : "running";
  return stage(id, status, id === "concept_discovery" ? discoveryProgress(discovery) : undefined);
}

function deriveReviewStage(
  run: ProcessingAuthoringRun,
  topicCount: number,
): DocumentProcessingStage {
  if (run.status === "failed" || run.status === "awaiting_provider" || run.status === "awaiting_cost_confirmation") {
    return stage("review_export", "waiting");
  }
  if (!["ready_for_review", "completed"].includes(run.status)) {
    return stage("review_export", "waiting");
  }
  if (!run.automaticTopicApprovalEnabled) {
    if (topicCount === 0) {
      return stage(
        "review_export",
        "completed",
        "All discovered topics have been reviewed.",
      );
    }
    return stage(
      "review_export",
      "action_required",
      `${topicCount} ${topicCount === 1 ? "topic is" : "topics are"} ready for human review.`,
    );
  }

  const automaticRun = run.automaticApprovalRun;
  if (!automaticRun) {
    return stage("review_export", "queued", "Preparing eligible topics for automatic approval and export.");
  }
  const counts = countAutomaticItems(automaticRun.items ?? []);
  if (automaticRun.status === "queued") {
    return stage("review_export", "queued", "Automatic approval and export are queued.");
  }
  if (automaticRun.status === "running") {
    return stage(
      "review_export",
      "running",
      `${counts.succeeded} completed, ${counts.active} still processing, ${counts.failed} failed or skipped.`,
    );
  }
  if (automaticRun.status === "completed") {
    return stage(
      "review_export",
      "completed",
      `${counts.succeeded} ${counts.succeeded === 1 ? "topic was" : "topics were"} approved and exported automatically.`,
    );
  }
  if (automaticRun.status === "completed_with_failures") {
    return stage(
      "review_export",
      "action_required",
      `${counts.succeeded} succeeded; ${counts.failed} require review or retry.`,
    );
  }
  return stage(
    "review_export",
    "failed",
    counts.failed > 0
      ? `${counts.failed} automatic approval items failed.`
      : "Automatic approval and export failed.",
  );
}

function finish(
  stages: DocumentProcessingStage[],
  automaticApprovalEnabled: boolean,
  hasAuthoringRun: boolean,
  bundleName: string,
): DocumentProcessingState {
  const current = stages.find((candidate) =>
    ["failed", "action_required", "running", "queued"].includes(candidate.status),
  ) ?? stages.at(-1)!;
  const active = stages.some((candidate) => candidate.status === "running" || candidate.status === "queued");
  const failed = stages.some((candidate) => candidate.status === "failed");
  const attention = stages.some((candidate) => candidate.status === "action_required");
  const terminal = !active && (failed || attention || stages.every((candidate) => candidate.status === "completed" || candidate.status === "skipped"));

  return {
    active,
    automaticApprovalEnabled,
    bundleName,
    currentDetail: current.detail,
    currentLabel: current.label,
    headerTone: failed ? "failed" : attention ? "attention" : active ? "active" : "success",
    showHeader: active || failed || attention || !hasAuthoringRun,
    stages,
    terminal,
  };
}

function stage(
  id: DocumentProcessingStageId,
  status: DocumentProcessingStageStatus,
  detail?: string,
): DocumentProcessingStage {
  return { detail: detail ?? stageCopy[id].detail, id, label: stageCopy[id].label, status };
}

function stageIndex(id: DocumentProcessingStageId) {
  return (Object.keys(stageCopy) as DocumentProcessingStageId[]).indexOf(id);
}

function extractionStageStatus(status: ExtractionStatus): DocumentProcessingStageStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return status;
}

function extractionDetail(status: ExtractionStatus, progress?: DocumentBatchProgress | null) {
  if ((status === "queued" || status === "running") && progress?.totalBatches) {
    return `Extracted ${progress.completedPages} of ${progress.totalPages} pages across ${progress.completedBatches} of ${progress.totalBatches} batches. OCR pages: ${progress.ocrPages}.`;
  }
  if (status === "failed") return "Text extraction failed. Review the error and retry the stored PDF.";
  if (status === "completed") return "Page-level source records are ready for downstream processing.";
  return stageCopy.extraction.detail;
}

function inspectionStageStatus(status: ExtractionStatus, progress?: DocumentBatchProgress | null): DocumentProcessingStageStatus {
  if (progress?.inspectionStatus === "action_required") return "action_required";
  if (progress?.inspectionStatus === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return status === "queued" ? "queued" : "waiting";
}

function discoveryProgress(discovery: Document["topicDiscovery"]) {
  if (!discovery || discovery.totalWindows <= 0) return stageCopy.concept_discovery.detail;
  return `Analyzed ${discovery.completedWindows} of ${discovery.totalWindows} document windows.`;
}

function countAutomaticItems(items: Array<{ status: string }>) {
  return items.reduce(
    (counts, item) => {
      if (item.status === "succeeded") counts.succeeded += 1;
      else if (["pending", "approving", "exporting"].includes(item.status)) counts.active += 1;
      else counts.failed += 1;
      return counts;
    },
    { active: 0, failed: 0, succeeded: 0 },
  );
}

export function isActiveExtractionStatus(status: ExtractionStatus) {
  return status === "queued" || status === "running";
}

export function isActiveDiscoveryStatus(status: TopicDiscoveryStatus) {
  return ["queued", "analyzing", "consolidating"].includes(status);
}
