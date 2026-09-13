"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { Color, Group, type PerspectiveCamera } from "three";
import { Focus, Maximize2, Minus, Plus } from "lucide-react";
import { useTheme } from "next-themes";
import type { OkfExplorerEdge, OkfExplorerNode } from "@/lib/okf-explorer";
import { entityGraphColorCss } from "@/lib/entity-graph-palette";
import { Button } from "@/components/ui/button";
import { useGraphCommunities } from "./use-graph-communities";
import { frameGraphBounds } from "@/lib/graph-framing";

type SpatialNode = OkfExplorerNode & { x: number; y: number; z: number };
type SpatialLink = Omit<OkfExplorerEdge, "source" | "target"> & {
  source: string | NodeObject<SpatialNode>;
  target: string | NodeObject<SpatialNode>;
};
const endpoint = (value: SpatialLink["source"]) => typeof value === "object" ? value.id : value;
const conceptColors: Record<string, string> = {
  dispatch_reference: "#e2a52b", fault_route: "#ee5b6b", routing_rule: "#ac7cde", system_topic: "#29b99c",
};

export default function KnowledgeGraph3D({ nodes, edges, selectedFile, onSelect, onSelectEdge, autoFocusSelected = false, colorMode = "concept" }: {
  nodes: OkfExplorerNode[]; edges: OkfExplorerEdge[]; selectedFile: string | null;
  onSelect: (id: string) => void; onSelectEdge?: (id: string) => void;
  autoFocusSelected?: boolean; colorMode?: "concept" | "entity";
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods<SpatialNode, SpatialLink> | undefined>(undefined);
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
  const [size, setSize] = useState({ width: 640, height: 500 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inspectedEdge, setInspectedEdge] = useState<OkfExplorerEdge | null>(null);
  const { communities, loading } = useGraphCommunities(nodes, edges);
  const framed = useRef(false);
  const focusId = hovered ?? selectedFile;
  // Seed by actual connectivity, while rendering every node and every link.
  // Grouping only gives the force simulation a stable starting position.
  const data = useMemo(() => {
    const groupById = new Map(communities.flatMap((group, index) => group.memberIds.map((id) => [id, index] as const)));
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes: nodes.map((node, index) => {
        const group = groupById.get(node.id) ?? 0;
        const angle = group * 2.399963;
        const radius = 65 * Math.sqrt(group);
        const offset = index * 2.399963;
        const spread = 25 + 6 * Math.sqrt(index % 61);
        const position = { x: Math.cos(angle) * radius + Math.cos(offset) * spread,
          y: Math.sin(angle) * radius + Math.sin(offset) * spread, z: ((index % 11) - 5) * 9 };
        // Isolated nodes have no spring to stop charge repulsion pushing them
        // out of frame. Keep them on a visible perimeter without inventing links.
        return node.degree === 0 ? { ...node, x: Math.cos(offset) * 180, y: Math.sin(offset) * 180, z: 0,
          fx: Math.cos(offset) * 180, fy: Math.sin(offset) * 180, fz: 0 } : { ...node, ...position };
      }),
      links: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })) as SpatialLink[],
    };
  }, [nodes, edges, communities]);
  const neighbors = useMemo(() => {
    const ids = new Set<string>();
    if (focusId) { ids.add(focusId); for (const edge of edges) {
      if (edge.source === focusId || edge.target === focusId) { ids.add(edge.source); ids.add(edge.target); }
    } }
    return ids;
  }, [focusId, edges]);
  const baseColor = useCallback((type: string) => colorMode === "entity" ? entityGraphColorCss(type) : conceptColors[type] ?? "#579fea", [colorMode]);
  const colors = useMemo(() => new Map([...new Set(nodes.map((node) => node.type))].map((type) => {
    const color = baseColor(type);
    return [type, { normal: color, muted: new Color(color).lerp(new Color(light ? "#ffffff" : "#20252c"), 0.3).getStyle() }];
  })), [nodes, baseColor, light]);
  const labels = useMemo(() => new Set([...nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .filter((node) => node.type !== "document" && node.type !== "other").slice(0, 6).map((node) => node.id)), [nodes]);
  const activeLink = useCallback((link: SpatialLink) => Boolean(focusId) && (endpoint(link.source) === focusId || endpoint(link.target) === focusId), [focusId]);
  const duration = reducedMotion ? 0 : 650;
  const fitNetwork = useCallback((animate = false) => {
    const instance = graph.current;
    const bounds = instance?.getGraphBbox();
    if (!instance || !bounds) return;
    const frame = frameGraphBounds(bounds, size.width, size.height, (instance.camera() as PerspectiveCamera).fov);
    instance.cameraPosition(frame.position, frame.center, animate ? duration : 0);
  }, [size.width, size.height, duration]);
  const zoom = (factor: number) => {
    const instance = graph.current;
    if (!instance) return;
    const position = instance.camera().position;
    const target = (instance.controls() as { target: { x: number; y: number; z: number } }).target;
    instance.cameraPosition({ x: target.x + (position.x - target.x) * factor,
      y: target.y + (position.y - target.y) * factor, z: target.z + (position.z - target.z) * factor }, target, duration);
  };
  const focus = useCallback((id: string) => {
    const node = data.nodes.find((item) => item.id === id);
    if (node) graph.current?.cameraPosition({ x: node.x + 80, y: node.y + 40, z: node.z + 160 }, node, duration);
  }, [data, duration]);
  useEffect(() => {
    if (autoFocusSelected && selectedFile && !loading) focus(selectedFile);
  }, [autoFocusSelected, selectedFile, loading, focus]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => { observer.disconnect(); preference.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    framed.current = false;
    graph.current?.d3Force("charge")?.strength(-45);
    graph.current?.d3Force("link")?.distance((link: SpatialLink) => link.relation === "occurs_in" ? 110 : 42);
  }, [data]);
  useEffect(() => {
    if (loading) return;
    // Wait for the renderer to apply new data and dimensions before measuring.
    // The engine-stop callback refits once the simulation settles.
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => fitNetwork());
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
  }, [fitNetwork, data, loading]);
  const nodeObject = useCallback((node: NodeObject<SpatialNode>) => {
    if (node.id !== selectedFile && node.id !== hovered && (focusId || !labels.has(node.id))) return new Group();
    const label = new SpriteText(node.title.length > 50 ? `${node.title.slice(0, 47)}…` : node.title, 3.5, light ? "#24292f" : "#f1f5f4");
    label.position.y = 8; label.backgroundColor = light ? "#ffffffdd" : "#15191fdd";
    label.padding = 1.5; label.borderRadius = 2;
    return label;
  }, [hovered, selectedFile, light, focusId, labels]);
  return <div className="absolute inset-0 top-16" ref={container}>
    <ForceGraph3D<SpatialNode, SpatialLink>
      ref={graph} graphData={data} width={size.width} height={size.height}
      backgroundColor={light ? "#f7f9f9" : "#101418"} controlType="orbit" showNavInfo={false}
      nodeLabel={() => ""} linkLabel={() => ""}
      nodeColor={(node) => colors.get(node.type)?.[focusId && !neighbors.has(node.id) ? "muted" : "normal"] ?? "#8b9baa"}
      nodeVal={(node) => 1.4 + Math.min(node.degree, 30) * 0.2}
      nodeResolution={8} nodeOpacity={0.95} nodeThreeObject={nodeObject} nodeThreeObjectExtend
      linkColor={(link) => activeLink(link) ? (light ? "#087d75" : "#75e0c7") : (light ? "#768f9a" : "#839ca5")}
      linkWidth={(link) => activeLink(link) ? 1.2 : 0.5}
      linkOpacity={0.65} linkDirectionalArrowLength={(link) => activeLink(link) && !["mentions", "occurs_in"].includes(link.relation) ? 2.5 : 0}
      linkDirectionalArrowRelPos={0.85}
      cooldownTicks={reducedMotion ? 0 : 100} warmupTicks={50}
      onEngineStop={() => { if (!framed.current && !loading) { framed.current = true; fitNetwork(); } }}
      onNodeHover={(node) => setHovered(node?.id ?? null)}
      onNodeClick={(node) => { onSelect(node.id); setInspectedEdge(null); }}
      onLinkClick={(link) => { if (onSelectEdge) onSelectEdge(link.id); else setInspectedEdge(edges.find((edge) => edge.id === link.id) ?? null); }}
    />
    <div className="absolute bottom-4 right-3 flex flex-col gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm">
      <Button size="icon" variant="ghost" aria-label="Fit entire network" title="Fit entire network" onClick={() => fitNetwork(true)}><Maximize2 className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Focus selected node" title="Focus selected node" disabled={!selectedFile} onClick={() => selectedFile && focus(selectedFile)}><Focus className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(0.7)}><Plus className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.4)}><Minus className="size-4" /></Button>
    </div>
    {inspectedEdge && <div className="absolute bottom-4 left-3 max-w-sm rounded-md border border-border bg-background/95 p-3 text-xs">
      <p className="font-medium">{inspectedEdge.relation.replaceAll("_", " ")}</p><p className="mt-2 max-h-28 overflow-auto">{inspectedEdge.reason}</p><Button size="sm" variant="ghost" onClick={() => setInspectedEdge(null)}>Close</Button>
    </div>}
  </div>;
}
