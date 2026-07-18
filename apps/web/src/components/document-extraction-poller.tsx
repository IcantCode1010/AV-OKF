"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { ExtractionStatus, TopicDiscoveryStatus } from "@/lib/document-vault";

export function DocumentExtractionPoller({
  authoringStatus = "not_started",
  status,
  topicDiscoveryStatus = "not_started",
}: {
  authoringStatus?: string;
  status: ExtractionStatus;
  topicDiscoveryStatus?: TopicDiscoveryStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    const extractionActive = status === "queued" || status === "running";
    const discoveryActive = ["queued", "analyzing", "consolidating"].includes(topicDiscoveryStatus);
    const authoringActive = ["queued", "running"].includes(authoringStatus);
    if (!extractionActive && !discoveryActive && !authoringActive) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [authoringStatus, router, status, topicDiscoveryStatus]);

  return null;
}
