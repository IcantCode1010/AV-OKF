"use client";

import { useState } from "react";
import { ChatAnswerGraph } from "@/components/chat/chat-answer-graph";
import { KnowledgeGraph, EntityGraphExplorer } from "@/components/knowledge-explorer/knowledge-explorer";
import type { EntityGraphSnapshot } from "@/lib/entity-graph-view";
import type { OkfExplorerNode, OkfExplorerEdge } from "@/lib/okf-explorer";

const names = ["Supply system", "Control unit", "Actuator", "Return circuit", "Inspection", "Operating limits"];
const nodes: OkfExplorerNode[] = Array.from({ length: 48 }, (_, index) => ({
  id: `concept-${index}`, title: `${names[index % names.length]} ${Math.floor(index / 6) + 1}`,
  type: ["system_topic", "fault_route", "dispatch_reference"][Math.floor(index / 16)],
  degree: 3, reviewStatus: "approved", sourceFile: "fictional-fixture.pdf", sourcePages: [index + 1],
}));
const edges: OkfExplorerEdge[] = nodes.flatMap((node, index) => [1, 6].map((offset) => ({
  id: `${index}-${offset}`, source: node.id, target: nodes[(index + offset) % nodes.length].id,
  relation: offset === 1 ? "references" : "depends_on", reason: "Fictional relationship for browser verification; not technical guidance.",
})));
const largeNodes = Array.from({ length: 2738 }, (_, index) => ({ ...nodes[index % nodes.length], id: `large-${index}`, title: `Concept ${index}` }));
const largeEdges = largeNodes.flatMap((node, index) => [1, 7, 31].map((offset) => ({ id: `${index}-${offset}`, source: node.id,
  target: largeNodes[(index + offset) % largeNodes.length].id, relation: "references", reason: "Fictional scale fixture" })));
const entitySnapshot: EntityGraphSnapshot = {
  nodes: nodes.map((node, index) => ({ ...node, kind: index % 4 === 0 ? "entity" : "topic", status: "grounded" })),
  edges: edges.map((edge, index) => ({ ...edge, status: ["published", "structural", "queued"][index % 3], pages: [1], evidenceQuote: "Fictional source quotation." })),
  summary: { attention: 32, entities: 12, occurrences: 32, published: 32 },
};

export function GraphPreview() {
  const [selected, setSelected] = useState<string | null>(null);
  const [scene, setScene] = useState("published");
  return <main className="p-4">
    <h1 className="text-xl font-semibold">Graph interaction preview</h1>
    <p className="text-sm text-muted-foreground">Development-only fictional data</p>
    <ChatAnswerGraph message={{ sessionId: "fixture", citations: [1].map((page, index) => ({
      index: index + 1, documentTitle: "Fictional manual", knowledgeBundleId: "fixture", documentId: "fixture-manual",
      researchEvidenceId: `fixture-evidence-${index}`, pageStart: page, pageEnd: page, sourceType: "rag", text: "Fictional browser fixture.",
    })), trace: { answerConnections: [{ sourceCitation: 1, targetCitation: 1, relation: "requires", sourceTitle: "Supply system", targetTitle: "Control unit", sourceTopicId: "supply", targetTopicId: "control" }] } }} />
    <label className="mt-2 block text-sm">Preview scene <select aria-label="Preview scene" className="rounded border p-1" value={scene} onChange={(event) => setScene(event.target.value)}><option value="published">Published graph</option><option value="entities">Entity explorer</option><option value="large">Large graph</option></select></label>
    <label className="mt-3 block text-sm">Select a concept <select aria-label="Select a concept" className="rounded border p-1" value={selected ?? ""} onChange={(event) => setSelected(event.target.value || null)}>
      <option value="">Overview</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
    </select></label>
    <section className="relative mt-3 h-[75vh] min-h-[560px] overflow-hidden rounded-xl border">
      {scene === "entities" ? <div className="flex h-full flex-col"><EntityGraphExplorer mode="entities" snapshot={entitySnapshot} /></div> : <>
      <div className="p-4 font-medium">Knowledge graph</div>
      <KnowledgeGraph key={scene} nodes={scene === "large" ? largeNodes : nodes} edges={scene === "large" ? largeEdges : edges} selectedFile={selected} onSelect={setSelected} autoFocusSelected={false} />
      </>}
    </section>
    <p aria-live="polite">Selected: {nodes.find((node) => node.id === selected)?.title ?? "none"}</p>
  </main>;
}
