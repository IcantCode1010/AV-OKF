"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ChatMessage } from "@/lib/chat-types";
import { getChatMessageCitationHref } from "@/lib/chat-citation-links";

const Graph = dynamic(() => import("@/components/knowledge-explorer/knowledge-explorer").then((module) => module.KnowledgeGraph), { ssr: false });

export function ChatAnswerGraph({ message }: { message: Pick<ChatMessage, "citations" | "sessionId"> & {
  trace: Pick<NonNullable<ChatMessage["trace"]>, "answerConnections"> | null;
} }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const view = useMemo(() => {
    const citations = new Map(message.citations.filter((citation) => !citation.lifecycleNotice).map((citation) => [citation.index, citation]));
    const nodeCitations = new Map<string, number>();
    const nodeTitles = new Map<string, string>();
    const edges = (message.trace?.answerConnections ?? []).filter((edge) => citations.has(edge.sourceCitation) && citations.has(edge.targetCitation)).map((edge, index) => {
      const source = edge.sourceTopicId ? `topic:${edge.sourceTopicId}` : `citation:${edge.sourceCitation}`;
      const target = edge.targetTopicId ? `topic:${edge.targetTopicId}` : `citation:${edge.targetCitation}`;
      nodeCitations.set(source, edge.sourceCitation); nodeCitations.set(target, edge.targetCitation);
      nodeTitles.set(source, edge.sourceTitle ?? citations.get(edge.sourceCitation)!.documentTitle);
      nodeTitles.set(target, edge.targetTitle ?? citations.get(edge.targetCitation)!.documentTitle);
      return { id: String(index), source, target, relation: edge.relation,
        sourceTitle: nodeTitles.get(source), targetTitle: nodeTitles.get(target),
        reason: "Published concept relationship discovered during retrieval. Read the linked source passages to verify the technical claim." };
    });
    const nodes = [...nodeCitations].map(([id, citationIndex]) => {
      const citation = citations.get(citationIndex)!;
      return { id, title: nodeTitles.get(id)!, type: "concept", reviewStatus: "approved",
        sourceFile: citation.sourceFile ?? null, sourcePages: [citation.pageStart],
        degree: edges.filter((edge) => edge.source === id || edge.target === id).length };
    });
    return { edges, nodes, citations, nodeCitations };
  }, [message.citations, message.trace?.answerConnections]);
  if (!view.edges.length) return null;
  const citation = selected ? view.citations.get(view.nodeCitations.get(selected) ?? -1) : undefined;
  const href = citation ? getChatMessageCitationHref(citation, message.sessionId) : null;
  return <details className="w-full rounded-lg border border-border p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Explore connections between cited concepts</summary>
    <p className="my-2 text-xs text-muted-foreground">Published concept relationships discovered during retrieval, linked to cited passages. Select a node to read its source.</p>
    {open && <div className="relative h-[480px] w-full overflow-hidden rounded-md border border-border">
      <div className="p-4 text-sm font-medium">Cited concepts</div>
      <Graph nodes={view.nodes} edges={view.edges} selectedFile={selected} onSelect={setSelected} autoFocusSelected />
    </div>}
    {citation && <div className="mt-3 rounded-md border border-border bg-muted/30 p-3" aria-live="polite">
      <p className="text-sm font-medium">{view.nodes.find((node) => node.id === selected)?.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">Cited excerpt · {citation.documentTitle} · page {citation.pageStart}</p>
      <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm">{citation.text}</blockquote>
      {href && <a className="mt-2 block text-sm underline" href={href}>Read {citation.documentTitle}{citation.sourceType === "rag" ? `, page ${citation.pageStart}` : ""}</a>}
    </div>}
    <ul className="mt-3 space-y-1 text-xs">
      {view.edges.map((edge) => <li key={edge.id}>
        <button type="button" className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(edge.source)}>{edge.sourceTitle}</button>
        {` → ${edge.relation.replaceAll("_", " ")} → `}
        <button type="button" className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(edge.target)}>{edge.targetTitle}</button>
      </li>)}
    </ul>
  </details>;
}
