"use client";

import { useEffect } from "react";

const POLL_INTERVAL_MS = 2_000;

type DeletionStatusResponse = {
  active: boolean;
  fingerprint: string;
};

export function DocumentDeletionPoller({
  active,
  fingerprint,
}: {
  active: boolean;
  fingerprint: string;
}) {
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let requestInFlight = false;

    async function poll() {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const response = await fetch("/api/document-deletions/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("document_deletion_status_unavailable");

        const next = (await response.json()) as DeletionStatusResponse;
        if (!isDeletionStatusResponse(next)) {
          throw new Error("document_deletion_status_invalid");
        }
        if (cancelled) return;

        if (hasDocumentDeletionStatusChanged(fingerprint, next.fingerprint)) {
          window.location.reload();
        }
      } catch {
        // A transient status failure must not turn into a visible refresh loop.
      } finally {
        requestInFlight = false;
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active, fingerprint]);

  return null;
}

export function hasDocumentDeletionStatusChanged(
  currentFingerprint: string,
  nextFingerprint: string,
) {
  return currentFingerprint !== nextFingerprint;
}

function isDeletionStatusResponse(
  value: DeletionStatusResponse,
): value is DeletionStatusResponse {
  return (
    typeof value?.active === "boolean" && typeof value.fingerprint === "string"
  );
}
