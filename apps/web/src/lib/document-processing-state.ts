import type {
  Document,
  ExtractionStatus,
  TopicDiscoveryStatus,
} from "./document-vault.ts";

export type DocumentProcessingStageId =
  | "upload"
  | "extraction"
  | "metadata_discovery"
  | "concept_discovery"
  | "enrichment"
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
  extraction: {
    errorCode: string | null;
    pageCount: number;
    status: string;
  };
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
  enrichment: {
    detail: "Preparing grounded titles, summaries, and article content for review.",
    label: "Topic enrichment",
  },
  relation_classification: {
    detail: "Identifying possible relationships between concepts for later review.",
    label: "Relation classification",
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
  topicCount: number;
}): DocumentProcessingState {
  const stages = initializeStages();
  stages[0] = stage("upload", input.document.storageKey ? "completed" : "skipped");
  stages[1] = stage("extraction", extractionStageStatus(input.document.extraction.status),
    extractionDetail(input.document.extraction.status));

  const run = input.authoringRun;
  if (input.document.extraction.status === "failed") {
    return finish(stages, false, false, input.bundleName);
  }
  if (input.document.extraction.status !== "completed") {
    return finish(stages, false, false, input.bundleName);
  }
  if (!run) {
    stages[2] = stage(
      "metadata_discovery",
      "action_required",
      "Extraction is complete. Start AI-assisted authoring when you are ready.",
    );
    return finish(stages, false, false, input.bundleName);
  }

  for (const id of authoringStageIds) {
    stages[stageIndex(id)] = deriveAuthoringStage(id, run, input.document.topicDiscovery);
  }
  stages[7] = deriveReviewStage(run, input.topicCount);

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
  topicDiscoveryStatus?: TopicDiscoveryStatus;
}) {
  return (
    input.derivedProcessingActive === true ||
    isActiveExtractionStatus(input.extractionStatus) ||
    isActiveDiscoveryStatus(input.topicDiscoveryStatus ?? "not_started") ||
    ["queued", "running"].includes(input.authoringStatus ?? "") ||
    ["queued", "running"].includes(input.automaticApprovalStatus ?? "")
  );
}

export function buildDocumentProcessingFingerprint(input: {
  authoringRun: ProcessingAuthoringRun | null;
  document: Pick<Document, "extraction" | "topicDiscovery">;
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

function extractionDetail(status: ExtractionStatus) {
  if (status === "failed") return "Text extraction failed. Review the error and retry the stored PDF.";
  if (status === "completed") return "Page-level source records are ready for downstream processing.";
  return stageCopy.extraction.detail;
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
