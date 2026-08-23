"use client";

import { useEffect } from "react";

export function TopicExpansionPoller({ active, bundleId, fingerprint }: { active: boolean; bundleId: string; fingerprint: string }) {
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/knowledge-bundles/${encodeURIComponent(bundleId)}/topic-expansion/status`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const next = await response.json() as { fingerprint?: unknown };
        if (typeof next.fingerprint === "string" && next.fingerprint !== fingerprint) window.location.reload();
      } catch {
        // Keep the last server-derived state visible through transient polling failures.
      }
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [active, bundleId, fingerprint]);
  return null;
}
