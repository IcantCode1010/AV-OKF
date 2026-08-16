"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2_000;

type BulkRunStatusResponse = {
  active: boolean;
  fingerprint: string;
};

export function BulkRunPoller({
  active,
  fingerprint,
  runId,
}: {
  active: boolean;
  fingerprint: string;
  runId: string;
}) {
  const router = useRouter();
  const latestFingerprint = useRef(fingerprint);

  useEffect(() => {
    if (!active) return;

    latestFingerprint.current = fingerprint;

    let cancelled = false;
    let requestInFlight = false;

    async function poll() {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const response = await fetch(
          `/api/bulk-topic-approval-runs/${encodeURIComponent(runId)}/status`,
          { cache: "no-store", credentials: "same-origin" },
        );
        if (!response.ok) return;

        const next = (await response.json()) as BulkRunStatusResponse;
        if (!isBulkRunStatusResponse(next) || cancelled) return;
        if (hasBulkRunStatusChanged(latestFingerprint.current, next.fingerprint)) {
          latestFingerprint.current = next.fingerprint;
          router.refresh();
        }
      } catch {
        // A transient status failure must not interrupt the run view.
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
  }, [active, fingerprint, router, runId]);

  return null;
}

export function hasBulkRunStatusChanged(
  currentFingerprint: string,
  nextFingerprint: string,
) {
  return currentFingerprint !== nextFingerprint;
}

function isBulkRunStatusResponse(
  value: BulkRunStatusResponse,
): value is BulkRunStatusResponse {
  return (
    typeof value?.active === "boolean" && typeof value.fingerprint === "string"
  );
}
