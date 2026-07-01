"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { ExtractionStatus } from "@/lib/document-vault";

export function DocumentExtractionPoller({
  status,
}: {
  status: ExtractionStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "queued" && status !== "running") {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [router, status]);

  return null;
}
