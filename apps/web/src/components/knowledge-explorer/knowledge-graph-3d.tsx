"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { Group } from "three";
import { useTheme } from "next-themes";
import type { OkfExplorerEdge, OkfExplorerNode } from "@/lib/okf-explorer";
import { entityGraphColorCss } from "@/lib/entity-graph-palette";
import { Button } from "@/components/ui/button";
import { projectGraphCommunities, type CommunityNode } from "@/lib/graph-communities";
import { useGraphCommunities } from "./use-graph-communities";

type SpatialNode = CommunityNode & { x: number; y: number; z: number };
type SpatialLink = Omit<OkfExplorerEdge, "source" | "target"> & {
  source: string | NodeObject<SpatialNode>;
  target: string | NodeObject<SpatialNode>;
};
const endpoint = (value: SpatialLink["source"]) => typeof value === "object" ? value.id : value;
const conceptColors: Record<string, string> = {
  dispatch_reference: "#f59e29", fault_route: "#f24f59",
  routing_rule: "#9e6ef2", system_topic: "#2bb98c",
  unlinked_group: "#8594aa",
};

export default function KnowledgeGraph3D({ nodes: sourceNodes, edges: sourceEdges, selectedFile, onSelect, autoFocusSelected = false, colorMode = "concept" }: {
  nodes: OkfExplorerNode[];
  edges: OkfExplorerEdge[];
  selectedFile: string | null;
  onSelect: (id: string) => void;
  autoFocusSelected?: boolean;
  colorMode?: "concept" | "entity";
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods<SpatialNode, SpatialLink> | undefined>(undefined);
  const { resolvedTheme } = useTheme();
  const [size, setSize] = useState({ width: 640, height: 500 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusEnabled, setFocusEnabled] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const controlsId = useId();
  const [detailChoice, setDetail] = useState<"groups" | "nodes" | null>(null);
  const detail = detailChoice ?? (sourceNodes.length > 80 ? "groups" : "nodes");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { communities, loading: grouping } = useGraphCommunities(sourceNodes, sourceEdges);
  const projection = useMemo(() => detail === "groups" ? projectGraphCommunities(sourceNodes, sourceEdges, communities, expanded)
    : { nodes: sourceNodes as CommunityNode[], edges: sourceEdges }, [detail, sourceNodes, sourceEdges, communities, expanded]);
  const { nodes, edges } = projection;
  const matchingNodes = useMemo(() => {
    const query = nodeSearch.trim().toLocaleLowerCase();
    return query ? sourceNodes.filter((node) => node.title.toLocaleLowerCase().includes(query)) : sourceNodes;
  }, [sourceNodes, nodeSearch]);
  const nodeOptions = useMemo(() => {
    const options = matchingNodes.slice(0, 100);
    const selected = sourceNodes.find((node) => node.id === selectedFile);
    return selected && !options.some((node) => node.id === selected.id) ? [selected, ...options] : options;
  }, [matchingNodes, sourceNodes, selectedFile]);
  const [relationship, setRelationship] = useState("all");
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inspectedEdge, setInspectedEdge] = useState<OkfExplorerEdge | null>(null);
  const framed = useRef(false);
  const externallyFocused = useRef<string | null>(null);
  const light = resolvedTheme === "light";
  const types = useMemo(() => [...new Set(nodes.map((node) => node.type))].sort(), [nodes]);
  // Collapsed communities can hide every internal edge. Keep the filter based
  // on the original assertions so those relationships remain discoverable.
  const relations = useMemo(() => [...new Set(sourceEdges.map((edge) => edge.relation))].sort(), [sourceEdges]);
  const activeRelation = relations.includes(relationship) ? relationship : "all";
  const visibleEdges = useMemo(() => activeRelation === "all" ? edges : edges.filter((edge) => edge.relation === activeRelation), [edges, activeRelation]);
  // ForceGraph mutates positions and endpoints. Never hand it application data.
  const data = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    const groups = new Map<string, number>();
    nodes.forEach((node) => { if (!groups.has(node.type)) groups.set(node.type, groups.size); });
    return {
      nodes: nodes.map((node, index) => {
        const angle = (groups.get(node.type)! / Math.max(groups.size, 1)) * Math.PI * 2;
        const offset = index * 2.399963;
        return { ...node, x: Math.cos(angle) * 130 + Math.cos(offset) * 45,
          y: Math.sin(angle) * 130 + Math.sin(offset) * 45, z: ((index % 9) - 4) * 15 };
      }),
      links: visibleEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })) as SpatialLink[],
    };
  }, [nodes, visibleEdges]);
  const focusId = hovered ?? (focusEnabled ? selectedFile : null);
  const neighbors = useMemo(() => {
    const ids = new Set<string>();
    if (focusId) {
      ids.add(focusId);
      visibleEdges.forEach((edge) => {
        if (edge.source === focusId || edge.target === focusId) { ids.add(edge.source); ids.add(edge.target); }
      });
    }
    return ids;
  }, [focusId, visibleEdges]);
  const color = useCallback((type: string) => colorMode === "entity" ? entityGraphColorCss(type) : conceptColors[type] ?? "#57a3f2", [colorMode]);
  const activeLink = useCallback((link: SpatialLink) => endpoint(link.source) === focusId || endpoint(link.target) === focusId, [focusId]);
  const overviewLabels = useMemo(() => new Set(types.slice(0, 8).map((type) =>
    [...nodes].filter((node) => node.type === type).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0]?.id,
  )), [nodes, types]);
  const focus = useCallback((id: string) => {
    const node = data.nodes.find((item) => item.id === id);
    setFocusEnabled(true);
    if (!node) {
      const community = communities.find((group) => group.memberIds.includes(id));
      if (community) setExpanded((current) => new Set([...current, community.id]));
      return;
    }
    if (!graph.current) return;
    graph.current.cameraPosition({ x: node.x + 90, y: node.y + 55, z: node.z + 180 }, node, reducedMotion ? 0 : 650);
  }, [data, reducedMotion, communities]);
  useEffect(() => {
    if (!selectedFile) { externallyFocused.current = null; return; }
    if (!autoFocusSelected || grouping || externallyFocused.current === selectedFile) return;
    if (!sourceNodes.some((node) => node.id === selectedFile)) return;
    const frame = requestAnimationFrame(() => {
      externallyFocused.current = selectedFile;
      focus(selectedFile);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedFile, autoFocusSelected, grouping, sourceNodes, focus]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => { observer.disconnect(); preference.removeEventListener("change", update); };
  }, []);
  useEffect(() => { framed.current = false; }, [data]);
  const nodeObject = useCallback((node: NodeObject<SpatialNode>) => {
    if (!node.memberIds && node.id !== selectedFile && node.id !== hovered && (focusId || !overviewLabels.has(node.id))) return new Group();
    const label = new SpriteText(node.title.length > 70 ? `${node.title.slice(0, 67)}…` : node.title, 4, light ? "#172033" : "#f1f5f9");
    label.position.y = 12;
    label.backgroundColor = light ? "#ffffffdd" : "#111827dd";
    label.padding = 2;
    label.borderRadius = 2;
    return label;
  }, [hovered, selectedFile, light, focusId, overviewLabels]);

  return <div className="absolute inset-0 top-16" ref={container}>
    {grouping && detail === "groups" && <div role="status" className="absolute inset-0 z-30 grid place-items-center bg-background/90 text-sm">Grouping connected concepts…</div>}
    <ForceGraph3D<SpatialNode, SpatialLink>
      ref={graph} graphData={data} width={size.width} height={size.height}
      backgroundColor={light ? "#f4f7fb" : "#080e1c"} controlType="orbit" showNavInfo={false}
      nodeLabel={() => ""} linkLabel={() => ""}
      nodeColor={(node) => focusId && !neighbors.has(node.id) ? (light ? "#c9d2df" : "#263044") : color(node.type)}
      nodeVal={(node) => 2 + Math.min(node.degree, 20) * 0.35}
      nodeResolution={12} nodeOpacity={0.95} nodeThreeObject={nodeObject} nodeThreeObjectExtend
      linkColor={(link) => activeLink(link) ? (light ? "#2563eb" : "#78bfff") : (light ? "#c5ceda" : "#26354b")}
      linkWidth={(link) => activeLink(link) ? 1.2 : 0.25}
      linkOpacity={0.55} linkDirectionalArrowLength={(link) => activeLink(link) ? 3 : 0}
      linkDirectionalArrowRelPos={0.85}
      cooldownTicks={reducedMotion ? 0 : 120} warmupTicks={40}
      onEngineStop={() => { if (!framed.current) { framed.current = true; if (focusEnabled && selectedFile && data.nodes.some((node) => node.id === selectedFile)) focus(selectedFile); else graph.current?.zoomToFit(reducedMotion ? 0 : 700, 65); } }}
      onNodeHover={(node) => setHovered(node?.id ?? null)}
      onNodeClick={(node) => {
        if (node.memberIds) { setFocusEnabled(false); setExpanded((current) => new Set([...current, node.id])); }
        else { onSelect(node.id); focus(node.id); }
        setInspectedEdge(null);
      }}
      onLinkClick={(link) => { const edge = edges.find((entry) => entry.id === link.id); setInspectedEdge(edge ?? null); }}
    />
    <div className="absolute left-3 right-28 top-3 w-fit max-w-[calc(100%-124px)] rounded-lg border border-border bg-background/95 p-2 shadow-sm">
      <Button className="sm:hidden" size="sm" variant="ghost" aria-expanded={controlsOpen} aria-controls={controlsId} onClick={() => setControlsOpen((value) => !value)}>{controlsOpen ? "Hide controls" : "Graph controls"}</Button>
      <div id={controlsId} className={`${controlsOpen ? "flex" : "hidden"} flex-wrap items-center gap-2 sm:flex`}>
      <select aria-label="Graph detail" className="rounded border border-border bg-background p-1 text-xs" value={detail} onChange={(event) => { setDetail(event.target.value as "groups" | "nodes"); setFocusEnabled(false); setInspectedEdge(null); }}>
        <option value="groups">Groups</option><option value="nodes">All nodes</option>
      </select>
      {detail === "groups" && <select aria-label="Expand a graph group" className="max-w-44 rounded border border-border bg-background p-1 text-xs" value="" onChange={(event) => { if (event.target.value) { setExpanded((current) => new Set([...current, event.target.value])); setFocusEnabled(false); } }}>
        <option value="">Expand a group…</option>{communities.filter((group) => group.memberIds.length > 1 && !expanded.has(group.id)).map((group) => <option key={group.id} value={group.id}>{group.title} ({group.memberIds.length})</option>)}
      </select>}
      {detail === "groups" && expanded.size > 0 && <Button size="sm" variant="ghost" onClick={() => { setExpanded(new Set()); setFocusEnabled(false); }}>Collapse groups</Button>}
      <label className="text-xs">Relationships <select aria-label="Filter graph relationships" className="ml-1 max-w-40 rounded border border-border bg-background p-1" value={activeRelation} onChange={(event) => { setRelationship(event.target.value); if (event.target.value !== "all") setDetail("nodes"); setFocusEnabled(false); setInspectedEdge(null); }}>
        <option value="all">All types</option>{relations.map((relation) => <option key={relation} value={relation}>{relation.replaceAll("_", " ")}</option>)}
      </select></label>
      <Button size="sm" variant="ghost" onClick={() => { setFocusEnabled(false); graph.current?.zoomToFit(reducedMotion ? 0 : 600, 65); }}>Reset view</Button>
      <Button size="sm" variant="ghost" disabled={!selectedFile} onClick={() => selectedFile && focus(selectedFile)}>Focus selected</Button>
      {sourceNodes.length > 80 && <input aria-label="Search graph concepts" type="search" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="Search concepts…" className="w-40 rounded border border-border bg-background p-1 text-xs" />}
      <select aria-label="Find graph node" className="max-w-44 rounded border border-border bg-background p-1 text-xs" value={selectedFile ?? ""} onChange={(event) => { if (event.target.value) { onSelect(event.target.value); focus(event.target.value); } }}>
        <option value="">{matchingNodes.length ? "Find a node…" : "No matching concepts"}</option>{nodeOptions.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
      </select>
      {sourceNodes.length > 80 && <span className="text-xs text-muted-foreground" role="status">{matchingNodes.length > 100 ? `Showing 100 of ${matchingNodes.length} matches. Refine your search.` : `${matchingNodes.length} matching concepts`}</span>}
      </div>
    </div>
    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-3 pointer-events-none">
      <div className="max-w-sm rounded-lg border border-border bg-background/95 p-3 text-xs">
        <p className="font-medium">Drag to rotate · Scroll to zoom · Click to explore</p>
        <p className="mt-1 text-muted-foreground">{nodes.length} nodes · {visibleEdges.length} connections. Position shows layout, not certainty.</p>
        {detail === "groups" && <p className="mt-1 text-muted-foreground">{sourceNodes.length} total nodes in {communities.length} navigation groups. Tap to expand.<span className="hidden sm:inline"> Unlinked concepts are collected for browsing; other groups reflect connectivity, not verified categories.</span></p>}
        <div className="mt-2 hidden flex-wrap gap-x-3 gap-y-1 sm:flex">{types.map((type) => <span key={type} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: color(type) }} />{type.replaceAll("_", " ")}</span>)}</div>
      </div>
      {inspectedEdge && <div className="pointer-events-auto max-w-sm rounded-lg border border-border bg-background/95 p-3 text-xs" aria-live="polite">
        <p className="font-medium">{nodes.find((node) => node.id === inspectedEdge.source)?.title} → {nodes.find((node) => node.id === inspectedEdge.target)?.title}</p>
        <p className="mt-1 text-primary">{inspectedEdge.relation.replaceAll("_", " ")}</p>
        <p className="mt-2 max-h-28 overflow-auto text-muted-foreground">{inspectedEdge.reason}</p>
        <Button size="sm" variant="ghost" onClick={() => setInspectedEdge(null)}>Close</Button>
      </div>}
    </div>
  </div>;
}
