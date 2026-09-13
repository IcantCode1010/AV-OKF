"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Search, SlidersHorizontal, X } from "lucide-react";
import { KnowledgeGraph } from "./knowledge-explorer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { entityGraphColorCss } from "@/lib/entity-graph-palette";
import { selectGraphNetwork, type GraphNetwork, type NetworkScope } from "@/lib/graph-network";

export function GraphNetworkExplorer({ network, initialScope, bundleId }: {
  network: GraphNetwork; initialScope: NetworkScope; bundleId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = initialScope;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const available = useMemo(() => selectGraphNetwork(network, scope), [network, scope]);
  const visible = useMemo(() => selectGraphNetwork(network, scope, hiddenTypes), [network, scope, hiddenTypes]);
  const selectedId = params.get("node") ?? network.nodes.find((node) => node.exportedFilePath === params.get("file"))?.id ?? null;
  const selected = visible.nodes.find((node) => node.id === selectedId);
  const selectedEdge = visible.edges.find((edge) => edge.id === edgeId);
  const byId = useMemo(() => new Map(network.nodes.map((node) => [node.id, node])), [network.nodes]);
  const linked = useMemo(() => selected ? visible.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [], [selected, visible.edges]);
  const types = useMemo(() => [...new Set(available.nodes.map((node) => node.type))].sort(), [available.nodes]);
  const matches = useMemo(() => query.trim() ? visible.nodes.filter((node) =>
    `${node.title} ${node.aliases.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())) : [], [query, visible.nodes]);
  const graphNodes = useMemo(() => visible.nodes.map((node) => ({ ...node,
    reviewStatus: node.status, sourceFile: null, sourcePages: [],
  })), [visible.nodes]);
  const select = (id: string | null) => {
    setEdgeId(null); setFiltersOpen(false); setQuery("");
    const next = new URLSearchParams(params);
    next.delete("node"); next.delete("file");
    const node = id ? byId.get(id) : null;
    if (node?.exportedFilePath) next.set("file", node.exportedFilePath);
    else if (id) next.set("node", id);
    // Native history keeps back/forward selection without reloading the graph.
    window.history.pushState(null, "", `${pathname}?${next}`);
  };
  const publishedCount = visible.edges.filter((edge) => edge.status === "published").length;
  return <section className="relative min-h-[min(520px,65dvh)] min-w-0 flex-1 overflow-hidden bg-background" aria-label="Bundle connection network">
    <div className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background px-3 sm:gap-4">
      <Button size="icon" variant={filtersOpen ? "secondary" : "ghost"} title="Filter network" aria-label="Filter network" aria-expanded={filtersOpen} onClick={() => { setFiltersOpen(!filtersOpen); setEdgeId(null); }}><SlidersHorizontal className="size-4" /></Button>
      <select aria-label="Graph connections" className="h-9 w-36 shrink-0 rounded-md border border-border bg-background px-2 text-sm max-sm:w-28" value={scope}
        onChange={(event) => { const next = new URLSearchParams(params); next.set("mode", event.target.value); next.delete("node"); next.delete("file"); setEdgeId(null); router.push(`${pathname}?${next}`, { scroll: false }); }}>
        <option value="network">Full network</option><option value="published">Published relations</option><option value="attention">Needs attention ({network.attentionCount})</option>
      </select>
      <div className="relative ml-auto min-w-0 w-full max-w-72">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input aria-label="Find in network" className="h-9 pl-8" placeholder="Find a topic or entity" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query.trim() && <div className="absolute right-0 top-11 z-40 max-h-72 w-[min(320px,80vw)] overflow-auto rounded-md border border-border bg-background p-1 shadow-lg" aria-label="Network search results">
          {matches.slice(0, 40).map((node) => <button key={node.id} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => select(node.id)}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: entityGraphColorCss(node.type) }} /><span className="min-w-0 break-words">{node.title}<span className="block text-xs text-muted-foreground">{node.type} · {node.degree} connections</span></span>
          </button>)}
          {!matches.length && <p className="p-3 text-sm text-muted-foreground">No matching nodes in this view.</p>}
          {matches.length > 40 && <p className="p-2 text-xs text-muted-foreground">{matches.length} matches. Refine your search.</p>}
        </div>}
      </div>
      <Button asChild size="icon" variant="ghost" title="Browse concepts" aria-label="Browse concepts"><Link href={`/knowledge/${encodeURIComponent(bundleId)}/browse${selected?.exportedFilePath ? `?file=${encodeURIComponent(selected.exportedFilePath)}` : ""}`}><BookOpen className="size-4" /></Link></Button>
    </div>
    <KnowledgeGraph autoFocusSelected={false} colorMode="entity" nodes={graphNodes} edges={visible.edges} selectedFile={selected?.id ?? null} onSelect={select} onSelectEdge={(id) => { setEdgeId(id); setFiltersOpen(false); }} />
    <div className="pointer-events-none absolute bottom-4 left-4 right-24 z-10 w-fit max-w-[calc(100%-112px)] text-xs text-muted-foreground" role="status">
      <span className="rounded bg-background/90 px-2 py-1">{visible.nodes.length} nodes · {visible.edges.length} connections</span>
      <p className="mt-2 w-fit rounded bg-background/90 px-2 py-1">{publishedCount} published · {visible.edges.filter((edge) => edge.status === "structural").length} source-evidence links{hiddenTypes.size ? ` · ${hiddenTypes.size} types hidden` : ""}</p>
    </div>
    {filtersOpen && <aside aria-label="Network filters" className="absolute bottom-24 left-3 top-[124px] z-30 w-[min(288px,calc(100%-24px))] overflow-auto rounded-md border border-border bg-background/95 p-4 shadow-lg">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Node types</h2><Button size="icon" variant="ghost" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><X className="size-4" /></Button></div>
      {types.map((type) => <label key={type} className="flex cursor-pointer items-center gap-2 py-2 text-sm"><input type="checkbox" checked={!hiddenTypes.has(type)} onChange={() => setHiddenTypes((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next; })} /><span className="size-2.5 rounded-full" style={{ background: entityGraphColorCss(type) }} /><span className="capitalize">{type === "other" ? "Other / unclassified" : type}</span><span className="ml-auto text-xs text-muted-foreground">{available.nodes.filter((node) => node.type === type).length}</span></label>)}
      <Button className="mt-2 w-full" variant="outline" size="sm" onClick={() => setHiddenTypes(new Set())}>Show all types</Button>
    </aside>}
    {(selected || selectedEdge) && !filtersOpen && <aside aria-label="Connection details" className="absolute bottom-24 right-3 top-[124px] z-30 w-[min(360px,calc(100%-24px))] overflow-auto rounded-md border border-border bg-background/95 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words text-base font-semibold">{selectedEdge ? `${byId.get(selectedEdge.source)?.title} → ${byId.get(selectedEdge.target)?.title}` : selected?.title}</h2><Button className="shrink-0" size="icon" variant="ghost" aria-label="Close details" onClick={() => { setEdgeId(null); select(null); }}><X className="size-4" /></Button></div>
      {selectedEdge ? <>
        <p className="mt-2 text-sm font-medium">{selectedEdge.relation.replaceAll("_", " ")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{selectedEdge.status === "structural" ? "Source evidence link · not an approved semantic relation" : selectedEdge.status} · {selectedEdge.count} supporting records</p>
        {selectedEdge.evidence.map((item, index) => <div key={`${item.id}-${index}`} className="mt-3 border-t border-border pt-3 text-sm"><p>{item.reason}</p>{item.evidenceQuote && item.evidenceQuote !== item.reason && <blockquote className="mt-2 border-l-2 border-primary pl-2">{item.evidenceQuote}</blockquote>}{item.pages.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Pages {item.pages.join(", ")}</p>}{item.confidence != null && <p className="mt-1 text-xs text-muted-foreground">Verifier confidence: {Math.round(item.confidence * 100)}%</p>}</div>)}
      </> : selected && <>
        <p className="mt-2 text-xs text-muted-foreground">{selected.type === "other" ? "Other / unclassified" : selected.type} · {selected.status} · {linked.length} connections</p>
        {selected.aliases.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Also known as: {selected.aliases.join(", ")}</p>}
        {selected.kind === "document" && <Button asChild size="sm" variant="outline" className="mt-3"><Link href={`/documents/${encodeURIComponent(selected.id.slice("document:".length))}`}><ArrowUpRight className="size-4" />Open source document</Link></Button>}
        {selected.exportedFilePath && <Button asChild size="sm" variant="outline" className="mt-3"><Link href={`/knowledge/${encodeURIComponent(bundleId)}/browse?file=${encodeURIComponent(selected.exportedFilePath)}`}><ArrowUpRight className="size-4" />Read concept</Link></Button>}
        {linked.map((edge) => { const other = byId.get(edge.source === selected.id ? edge.target : edge.source); return <div key={edge.id} className="mt-3 border-t border-border pt-3"><button onClick={() => select(other?.id ?? null)} className="text-left text-sm font-medium text-primary hover:underline">{other?.title}</button><button onClick={() => setEdgeId(edge.id)} className="mt-1 block text-left text-xs text-muted-foreground hover:text-foreground">{edge.relation.replaceAll("_", " ")} · {edge.status} · View evidence</button></div>; })}
        {!linked.length && <p className="mt-4 text-sm text-muted-foreground">No recorded connections in this view.</p>}
      </>}
    </aside>}
  </section>;
}
