"use client";

import type { ExtractionStatus, TopicDiscoveryStatus } from "@/lib/document-vault";
import { shouldPollDocumentProcessing } from "@/lib/document-processing-state";
import type { DocumentProcessingProgressData } from "@/lib/production-document-processing-status";
import type { OperationProgressSnapshot } from "@/lib/operation-progress";
import { useOperationProgress, useOperationTerminalRefresh } from "./use-operation-progress";

export function DocumentExtractionPoller({
  authoringStatus = "not_started",
  automaticApprovalStatus = "not_started",
  documentId,
  fingerprint,
  processingActive = false,
  status,
  topicDiscoveryStatus = "not_started",
}: {
  authoringStatus?: string;
  automaticApprovalStatus?: string;
  documentId: string;
  fingerprint: string;
  processingActive?: boolean;
  status: ExtractionStatus;
  topicDiscoveryStatus?: TopicDiscoveryStatus;
}) {
  const active = shouldPollDocumentProcessing({
      authoringStatus,
      automaticApprovalStatus,
      derivedProcessingActive: processingActive,
      extractionStatus: status,
      topicDiscoveryStatus,
    });
  const initialSnapshot: OperationProgressSnapshot<DocumentProcessingProgressData> = {
    active,
    data: {
      authoring: null, automaticApproval: null,
      entities: { completed: 0, failed: 0, queued: 0, running: 0 },
      extraction: { completed: 0, ocrPages: 0, status, total: 0 },
      ragIndex: null,
      topicDiscovery: { completed: 0, status: topicDiscoveryStatus, total: 0 },
    },
    fingerprint,
    generatedAt: new Date().toISOString(),
    operations: [],
  };
  const refreshTerminal = useOperationTerminalRefresh();
  const { connected, snapshot } = useOperationProgress({
    initialSnapshot,
    onTerminal: refreshTerminal,
    url: `/api/documents/${encodeURIComponent(documentId)}/processing-status`,
  });
  const current = snapshot.operations.find((operation) => operation.status === "running")
    ?? snapshot.operations.find((operation) => operation.status === "action_required")
    ?? snapshot.operations.find((operation) => operation.status === "queued");
  if (!current || (!snapshot.active && connected)) return null;
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <div className="min-w-0">
        <span className="font-medium">Processing document · {current.label}</span>
        <p className="truncate text-xs text-muted-foreground">{current.detail}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{!connected ? "Reconnecting..." : current.stage.replaceAll("_", " ")}</span>
    </div>
  );
}
