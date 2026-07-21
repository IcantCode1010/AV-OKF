"use client";

import { useEffect } from "react";

import type { ExtractionStatus, TopicDiscoveryStatus } from "@/lib/document-vault";
import { shouldPollDocumentProcessing } from "@/lib/document-processing-state";

const POLL_INTERVAL_MS = 2_000;

type ProcessingStatusResponse = {
  active: boolean;
  fingerprint: string;
};

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
    let reloadRequested = false;
    const transitionKey = `document-processing-transition:${documentId}`;
    const poll = async () => {
      if (requestInFlight || reloadRequested) return;
      requestInFlight = true;
      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(documentId)}/processing-status`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as ProcessingStatusResponse;
        if (!isProcessingStatusResponse(payload) || cancelled) return;

        const previousTransition = window.sessionStorage.getItem(transitionKey);
        const decision = resolveDocumentProcessingPollDecision({
          currentFingerprint: fingerprint,
          next: payload,
          previousTransition,
        });

        if (decision === "reload") {
          reloadRequested = true;
          window.sessionStorage.setItem(
            transitionKey,
            buildProcessingTransition(fingerprint, payload.fingerprint),
          );
          window.location.reload();
          return;
        }

        if (decision === "stop") {
          window.clearInterval(intervalId);
          return;
        }

        if (payload.fingerprint === fingerprint) {
          window.sessionStorage.removeItem(transitionKey);
        }
      } catch {
        // A transient poll failure must not interrupt the visible workflow.
      } finally {
        requestInFlight = false;
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authoringStatus, automaticApprovalStatus, documentId, fingerprint, processingActive, status, topicDiscoveryStatus]);

  return null;
}

export function resolveDocumentProcessingPollDecision(input: {
  currentFingerprint: string;
  next: ProcessingStatusResponse;
  previousTransition: string | null;
}): "continue" | "reload" | "stop" {
  if (input.next.fingerprint === input.currentFingerprint) {
    return input.next.active ? "continue" : "stop";
  }

  return input.previousTransition ===
    buildProcessingTransition(input.currentFingerprint, input.next.fingerprint)
    ? "stop"
    : "reload";
}

function buildProcessingTransition(currentFingerprint: string, nextFingerprint: string) {
  return `${currentFingerprint}\u0000${nextFingerprint}`;
}

function isProcessingStatusResponse(
  value: ProcessingStatusResponse,
): value is ProcessingStatusResponse {
  return (
    typeof value?.active === "boolean" && typeof value.fingerprint === "string"
  );
}
