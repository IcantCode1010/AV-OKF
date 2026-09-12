"use client";

import { useEffect, useMemo, useState } from "react";
import { detectGraphCommunities, type GraphCommunity } from "@/lib/graph-communities";
import type { OkfExplorerNode, OkfExplorerEdge } from "@/lib/okf-explorer";

export function useGraphCommunities(nodes: OkfExplorerNode[], edges: OkfExplorerEdge[]) {
  const small = nodes.length <= 1000;
  const immediate = useMemo(() => small ? detectGraphCommunities(nodes, edges) : [], [nodes, edges, small]);
  const [completed, setCompleted] = useState<{ nodes: typeof nodes; edges: typeof edges; groups: GraphCommunity[] } | null>(null);
  useEffect(() => {
    if (small) return;
    let disposed = false;
    let worker: Worker | undefined;
    const finish = (groups: GraphCommunity[]) => { if (!disposed) setCompleted({ nodes, edges, groups }); };
    const fallback = () => {
      worker?.terminate();
      if (!disposed) finish(detectGraphCommunities(nodes, edges));
    };
    try {
      worker = new Worker(new URL("./graph-communities.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<GraphCommunity[]>) => { finish(event.data); worker?.terminate(); };
      worker.onerror = fallback;
      worker.postMessage({ nodes, edges });
    } catch { fallback(); }
    return () => { disposed = true; worker?.terminate(); };
  }, [nodes, edges, small]);
  const current = completed?.nodes === nodes && completed.edges === edges ? completed.groups : null;
  return { communities: small ? immediate : current ?? [], loading: !small && current === null };
}
