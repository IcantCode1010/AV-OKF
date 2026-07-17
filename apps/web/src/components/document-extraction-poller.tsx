"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { ExtractionStatus, TopicDiscoveryStatus } from "@/lib/document-vault";

export function DocumentExtractionPoller({
  status,
  topicDiscoveryStatus = "not_started",
}: {
  status: ExtractionStatus;
  topicDiscoveryStatus?: TopicDiscoveryStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    const extractionActive = status === "queued" || status === "running";
    const discoveryActive = ["queued", "analyzing", "consolidating"].includes(topicDiscoveryStatus);
    if (!extractionActive && !discoveryActive) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [router, status, topicDiscoveryStatus]);

  return null;
}
