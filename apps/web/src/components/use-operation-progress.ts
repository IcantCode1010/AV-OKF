"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  operationProgressBackoffMs,
  parseOperationProgressSnapshot,
  shouldRefreshOperationProgressTerminal,
  type OperationProgressSnapshot,
} from "@/lib/operation-progress";

const POLL_INTERVAL_MS = 2_000;

export function useOperationProgress<T>({
  initialSnapshot,
  onTerminal,
  url,
}: {
  initialSnapshot: OperationProgressSnapshot<T>;
  onTerminal?: () => void;
  url: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connected, setConnected] = useState(true);
  const snapshotRef = useRef(initialSnapshot);
  const terminalRefreshDone = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const poll = useCallback(async (signal?: AbortSignal) => {
    if (inFlight.current) return snapshotRef.current.active;
    inFlight.current = true;
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
      if (!response.ok) throw new Error("operation_progress_unavailable");
      const next = parseOperationProgressSnapshot<T>(await response.json());
      if (!next) throw new Error("operation_progress_invalid");
      const wasActive = snapshotRef.current.active;
      snapshotRef.current = next;
      setSnapshot(next);
      setConnected(true);
      if (onTerminal && shouldRefreshOperationProgressTerminal({
        alreadyRefreshed: terminalRefreshDone.current,
        nextActive: next.active,
        previousActive: wasActive,
      })) {
        terminalRefreshDone.current = true;
        onTerminal();
      }
      return next.active;
    } finally {
      inFlight.current = false;
    }
  }, [onTerminal, url]);

  useEffect(() => {
    if (!snapshot.active) return;
    let cancelled = false;
    let timeout: number | undefined;
    let controller: AbortController | undefined;
    let failures = 0;

    const schedule = (delay: number) => {
      timeout = window.setTimeout(run, delay);
    };
    const run = async () => {
      if (cancelled || document.hidden || !navigator.onLine) return;
      controller = new AbortController();
      try {
        const active = await poll(controller.signal);
        failures = 0;
        if (active && !cancelled) schedule(POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        setConnected(false);
        failures += 1;
        schedule(operationProgressBackoffMs(failures));
      }
    };
    const resume = () => {
      if (cancelled || document.hidden || !navigator.onLine) return;
      if (timeout) window.clearTimeout(timeout);
      void run();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    void run();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timeout) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [poll, snapshot.active]);

  return { connected, snapshot };
}

export function useOperationTerminalRefresh() {
  const router = useRouter();
  return useCallback(() => router.refresh(), [router]);
}
