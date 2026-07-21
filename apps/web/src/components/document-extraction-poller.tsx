"use client";

import { useEffect } from "react";

import type { ExtractionStatus, TopicDiscoveryStatus } from "@/lib/document-vault";
import { shouldPollDocumentProcessing } from "@/lib/document-processing-state";

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
  useEffect(() => {
    if (!shouldPollDocumentProcessing({
      authoringStatus,
      automaticApprovalStatus,
      derivedProcessingActive: processingActive,
      extractionStatus: status,
      topicDiscoveryStatus,
    })) {
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const poll = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(documentId)}/processing-status`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { fingerprint?: unknown };
        if (
          !cancelled &&
          typeof payload.fingerprint === "string" &&
          payload.fingerprint !== fingerprint
        ) {
          window.location.reload();
        }
      } catch {
        // A transient poll failure must not interrupt the visible workflow.
      } finally {
        requestInFlight = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authoringStatus, automaticApprovalStatus, documentId, fingerprint, processingActive, status, topicDiscoveryStatus]);

  return null;
}
