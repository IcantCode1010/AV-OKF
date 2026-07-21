"use client";

import { useEffect } from "react";

const POLL_INTERVAL_MS = 2_000;

export function KnowledgeBundleDeletionPoller({
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
        const response = await fetch("/api/knowledge-bundle-deletions/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const next = await response.json() as { active?: unknown; fingerprint?: unknown };
        if (cancelled || typeof next.fingerprint !== "string") return;
        if (next.fingerprint !== fingerprint) window.location.reload();
      } catch {
        // Transient status errors must not create a refresh loop.
      } finally {
        requestInFlight = false;
      }
    }
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [active, fingerprint]);
  return null;
}
