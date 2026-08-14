"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Focus,
  Folder,
  FolderOpen,
  GripVertical,
  Maximize2,
  Network,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  buildOkfGraphView,
  type OkfGraphViewMode,
} from "@/lib/okf-graph-view";
import {
  type OkfExplorerDocument,
  type OkfExplorerEdge,
  type OkfExplorerIssue,
  type OkfExplorerNode,
  type OkfExplorerSnapshot,
  type OkfTreeNode,
} from "@/lib/okf-explorer";

function useExplorerSelection() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectFile = useCallback(
    (filename: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("file", filename);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return selectFile;
}

export function KnowledgeExplorer({ snapshot }: { snapshot: OkfExplorerSnapshot }) {
  return <KnowledgeBrowse snapshot={snapshot} />;
}

export function KnowledgeBrowse({ snapshot }: { snapshot: OkfExplorerSnapshot }) {
  const selectFile = useExplorerSelection();
  const [filter, setFilter] = useState("");
  const [treeWidth, setTreeWidth] = useState(288);
  const filteredTree = useMemo(
    () => filterTree(snapshot.tree, filter),
    [filter, snapshot.tree],
  );

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = treeWidth;
    const move = (moveEvent: PointerEvent) => {
      setTreeWidth(Math.min(440, Math.max(220, startWidth + moveEvent.clientX - startX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, [treeWidth]);

  return (
    <>
      <div
        className="relative hidden min-h-0 flex-1 overflow-hidden border-y border-border lg:grid"
        style={{ gridTemplateColumns: `${treeWidth}px 8px minmax(0,1fr)` }}
      >
        <ExplorerTreePane filter={filter} onFilter={setFilter} selectedFile={snapshot.selectedFile} tree={filteredTree} onSelect={selectFile} />
        <button aria-label="Resize concept tree" className="group flex cursor-col-resize items-center justify-center border-r border-border bg-muted/20 hover:bg-muted" onPointerDown={beginResize} type="button"><GripVertical className="size-3.5 text-muted-foreground group-hover:text-foreground" /></button>
        <ExplorerReaderPane
          document={snapshot.selectedDocument}
          files={snapshot.files.map((file) => ({ filename: file.filename, title: file.title }))}
          issues={snapshot.issues}
          onSelect={selectFile}
        />
      </div>

      <Tabs className="min-h-[560px] flex-1 lg:hidden" defaultValue="tree">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tree"><Folder className="size-4" />Tree</TabsTrigger>
          <TabsTrigger value="reader"><BookOpen className="size-4" />Reader</TabsTrigger>
        </TabsList>
        <TabsContent value="tree" className="min-h-[560px] border-y border-border">
          <ExplorerTreePane
            filter={filter}
            onFilter={setFilter}
            selectedFile={snapshot.selectedFile}
            tree={filteredTree}
            onSelect={selectFile}
          />
        </TabsContent>
        <TabsContent value="reader" className="min-h-[560px] border-y border-border">
          <ExplorerReaderPane
            document={snapshot.selectedDocument}
            files={snapshot.files.map((file) => ({ filename: file.filename, title: file.title }))}
            issues={snapshot.issues}
            onSelect={selectFile}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function KnowledgeGraphExplorer({
  browseHref,
  snapshot,
}: {
  browseHref: string;
  snapshot: OkfExplorerSnapshot;
}) {
  const selectFile = useExplorerSelection();
  const [viewMode, setViewMode] = useState<OkfGraphViewMode>("neighborhood");
  const graphView = useMemo(
    () => buildOkfGraphView({
      edges: snapshot.edges,
      mode: viewMode,
      nodes: snapshot.nodes,
      selectedFile: snapshot.selectedFile,
    }),
    [snapshot.edges, snapshot.nodes, snapshot.selectedFile, viewMode],
  );
  const focusedDocument = useMemo(() => {
    if (snapshot.selectedDocument && !snapshot.selectedDocument.isReserved) {
      return snapshot.selectedDocument;
    }
    const file = snapshot.files.find((candidate) => candidate.filename === graphView.focusFile);
    if (!file) return null;
    const titleByFile = new Map(snapshot.nodes.map((node) => [node.id, node.title]));
    return {
      ...file,
      incoming: snapshot.edges
        .filter((edge) => edge.target === file.filename)
        .map((edge) => ({
          approvalMode: edge.approvalMode,
          reason: edge.reason,
          relation: edge.relation,
          sourceFile: edge.source,
          sourceTitle: titleByFile.get(edge.source) ?? edge.source,
        })),
      outgoing: snapshot.edges.filter((edge) => edge.source === file.filename),
    };
  }, [graphView.focusFile, snapshot.edges, snapshot.files, snapshot.nodes, snapshot.selectedDocument]);
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[560px_minmax(360px,auto)] overflow-y-auto border-y border-border lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 lg:overflow-hidden">
      <ExplorerGraphPane
        allEdgeCount={snapshot.edges.length}
        allNodeCount={snapshot.nodes.length}
        edges={graphView.edges}
        mode={viewMode}
        nodes={graphView.nodes}
        onModeChange={setViewMode}
        onSelect={selectFile}
        selectedFile={graphView.focusFile}
        standalone
      />
      <GraphDetailPane
        browseHref={browseHref}
        document={focusedDocument}
        isolatedNodes={graphView.isolatedNodes}
        onSelect={selectFile}
      />
    </div>
  );
}

function ExplorerTreePane({
  filter,
  onFilter,
  onSelect,
  selectedFile,
  tree,
}: {
  filter: string;
  onFilter: (value: string) => void;
  onSelect: (filename: string) => void;
  selectedFile: string | null;
  tree: OkfTreeNode[];
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = scrollContainerRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    selected?.scrollIntoView({ block: "center" });
  }, [selectedFile]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-muted/10" aria-label="Knowledge file tree">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Bundle files</p>
        <p className="mt-1 text-xs text-muted-foreground">Physical folder structure</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Filter bundle files" className="h-8 bg-background pl-8 text-xs" onChange={(event) => onFilter(event.target.value)} placeholder="Filter concepts" value={filter} />
        </div>
      </div>
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto p-2">
        {tree.length > 0 ? (
          tree.map((node) => (
            <TreeNode key={node.id} node={node} onSelect={onSelect} selectedFile={selectedFile} />
          ))
        ) : (
          <EmptyPane label="No active Markdown files are available." />
        )}
      </div>
    </aside>
  );
}

function TreeNode({
  depth = 0,
  node,
  onSelect,
  selectedFile,
}: {
  depth?: number;
  node: OkfTreeNode;
  onSelect: (filename: string) => void;
  selectedFile: string | null;
}) {
  const containsSelection =
    selectedFile === node.id || Boolean(selectedFile?.startsWith(`${node.id}/`));
  const [open, setOpen] = useState(containsSelection || depth === 0);
  const effectiveOpen = open || containsSelection;

  if (node.kind === "file") {
    const selected = selectedFile === node.id;
    return (
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          "flex min-h-9 w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          selected
            ? "border-primary bg-primary/10 font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        aria-current={selected ? "page" : undefined}
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{node.label}</span>
      </button>
    );
  }

  const FolderIcon = effectiveOpen ? FolderOpen : Folder;
  return (
    <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-9 w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
        >
          {effectiveOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <FolderIcon className="size-3.5 text-muted-foreground" />
          <span className="truncate">{node.label}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children.map((child) => (
          <TreeNode
            key={child.id}
            depth={depth + 1}
            node={child}
            onSelect={onSelect}
            selectedFile={selectedFile}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExplorerGraphPane({
  allEdgeCount,
  allNodeCount,
  edges,
  mode,
  nodes,
  onModeChange,
  onSelect,
  selectedFile,
  standalone = false,
}: {
  allEdgeCount: number;
  allNodeCount: number;
  edges: OkfExplorerEdge[];
  mode: OkfGraphViewMode;
  nodes: OkfExplorerNode[];
  onModeChange: (mode: OkfGraphViewMode) => void;
  onSelect: (filename: string) => void;
  selectedFile: string | null;
  standalone?: boolean;
}) {
  return (
    <section className={cn("relative min-h-[560px] bg-background", !standalone && "border-r border-border")} aria-label="Knowledge graph">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Knowledge graph</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "neighborhood"
              ? `${nodes.length} of ${allNodeCount} concepts / ${edges.length} of ${allEdgeCount} relations`
              : `${allNodeCount} concepts / ${allEdgeCount} relations`}
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5" aria-label="Graph view mode">
          <Button
            aria-pressed={mode === "neighborhood"}
            className="h-7 px-2.5 text-xs"
            onClick={() => onModeChange("neighborhood")}
            size="sm"
            variant={mode === "neighborhood" ? "secondary" : "ghost"}
          >
            Neighborhood
          </Button>
          <Button
            aria-pressed={mode === "all"}
            className="h-7 px-2.5 text-xs"
            onClick={() => onModeChange("all")}
            size="sm"
            variant={mode === "all" ? "secondary" : "ghost"}
          >
            All concepts
          </Button>
        </div>
      </div>
      <KnowledgeGraph
        autoFocusSelected={mode === "neighborhood"}
        edges={edges}
        nodes={nodes}
        selectedFile={selectedFile}
        onSelect={onSelect}
      />
    </section>
  );
}

type GraphInstance = import("@cosmos.gl/graph").Graph;

function KnowledgeGraph({
  autoFocusSelected,
  edges,
  nodes,
  onSelect,
  selectedFile,
}: {
  autoFocusSelected: boolean;
  edges: OkfExplorerEdge[];
  nodes: OkfExplorerNode[];
  onSelect: (filename: string) => void;
  selectedFile: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const graphRef = useRef<GraphInstance | null>(null);
  const nodesRef = useRef(nodes);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [labelPositions, setLabelPositions] = useState<Map<number, [number, number]>>(new Map());
  const topologyKey = useMemo(
    () => `${nodes.map((node) => node.id).join("|")}::${edges.map((edge) => edge.id).join("|")}`,
    [edges, nodes],
  );
  const selectedIndex = nodes.findIndex((node) => node.id === selectedFile);
  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);
  const labelIndices = useMemo(
    () => Array.from(new Set([
      ...(selectedIndex >= 0 ? [selectedIndex] : []),
      ...(hoveredIndex !== null ? [hoveredIndex] : []),
    ])),
    [hoveredIndex, selectedIndex],
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const refreshLabels = useCallback(() => {
    const graph = graphRef.current;
    if (!graph?.isReady) return;
    graph.trackPointPositionsByIndices(labelIndices);
    const positions = new Map<number, [number, number]>();
    for (const [index, position] of graph.getTrackedPointPositionsMap()) {
      positions.set(index, graph.spaceToScreenPosition(position));
    }
    setLabelPositions(positions);
  }, [labelIndices]);

  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let settleTimer: number | null = null;
    const container = containerRef.current;

    void import("@cosmos.gl/graph")
      .then(({ Graph }) => {
        if (cancelled) return;
        const graph = new Graph(container, {
          backgroundColor: resolvedTheme === "light" ? "#ffffff" : "#0b0d10",
          curvedLinks: true,
          enableDrag: true,
          fitViewDelay: 300,
          fitViewOnInit: true,
          fitViewPadding: 0.22,
          linkDefaultArrows: true,
          linkDefaultColor: resolvedTheme === "light" ? "#a1a1aa" : "#586171",
          linkDefaultWidth: 1.1,
          pointGreyoutOpacity: 0.18,
          pointDefaultSize: 7,
          renderHoveredPointRing: true,
          simulationCollision: 1,
          simulationCollisionPadding: 10,
          simulationCollisionRadius: 10,
          simulationCenter: 0.15,
          simulationDecay: 6000,
          simulationFriction: 0.72,
          simulationGravity: 0.08,
          simulationLinkDistance: 80,
          simulationLinkSpring: 0.65,
          simulationRepulsion: 1,
          onPointClick: (index) => {
            const node = nodesRef.current[index];
            if (node) onSelect(node.id);
          },
          onPointMouseOver: (index) => setHoveredIndex(index),
          onPointMouseOut: () => setHoveredIndex(null),
          onSimulationEnd: () => frameSelectedOrFit(
            graphRef.current,
            autoFocusSelected ? selectedIndexRef.current : -1,
            300,
          ),
          onSimulationTick: () => refreshLabels(),
          onZoom: () => refreshLabels(),
        });
        graphRef.current = graph;
        const positions = new Float32Array(nodes.length * 2);
        nodes.forEach((_, index) => {
          const ringSize = 20;
          const ring = Math.floor(index / ringSize);
          const positionInRing = index % ringSize;
          const pointsInRing = Math.min(ringSize, nodes.length - ring * ringSize);
          const angle = (Math.PI * 2 * positionInRing) / Math.max(pointsInRing, 1);
          const radius = 120 + ring * 90;
          positions[index * 2] = Math.cos(angle) * radius;
          positions[index * 2 + 1] = Math.sin(angle) * radius;
        });
        const indexById = new Map(nodes.map((node, index) => [node.id, index]));
        const links = edges.flatMap((edge) => [
          indexById.get(edge.source)!,
          indexById.get(edge.target)!,
        ]);
        graph.setPointPositions(positions);
        graph.setPointColors(new Float32Array(nodes.flatMap((node) => colorForType(node.type))));
        graph.setPointSizes(new Float32Array(nodes.map((node) => 8 + Math.min(node.degree, 8) * 1.5)));
        graph.setLinks(new Float32Array(links));
        graph.setLinkArrows(edges.map(() => true));
        graph.render();
        settleTimer = window.setTimeout(() => {
          if (graphRef.current !== graph) return;
          graph.stop();
          frameSelectedOrFit(graph, autoFocusSelected ? selectedIndexRef.current : -1, 350);
        }, 1800);
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
            return;
          }

          window.requestAnimationFrame(() => {
            if (graphRef.current === graph) {
              graph.render();
              frameSelectedOrFit(
                graph,
                autoFocusSelected ? selectedIndexRef.current : -1,
                250,
              );
            }
          });
        });
        resizeObserver = observer;
        observer.observe(container);
        graph.ready.finally(() => {
          if (cancelled) observer.disconnect();
        });
        return graph.ready;
      })
      .then(() => {
        if (!cancelled) refreshLabels();
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "WebGL initialization failed");
        }
      });

    return () => {
      cancelled = true;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  // Topology changes rebuild the simulation; selection changes do not.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusSelected, topologyKey, resolvedTheme]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const connectedLinks = selectedIndex >= 0
      ? edges
          .map((edge, index) => edge.source === selectedFile || edge.target === selectedFile ? index : -1)
          .filter((index) => index >= 0)
      : [];
    graph.setConfigPartial({
      focusedPointIndex: selectedIndex >= 0 ? selectedIndex : undefined,
      highlightedLinkIndices: connectedLinks,
      highlightedPointIndices: selectedIndex >= 0 ? [selectedIndex] : [],
      outlinedPointIndices: selectedIndex >= 0 ? [selectedIndex] : [],
    });
    if (autoFocusSelected && selectedIndex >= 0) {
      graph.zoomToPointByIndex(selectedIndex, 350, 2.2, false, false);
    }
    refreshLabels();
  }, [autoFocusSelected, edges, refreshLabels, selectedFile, selectedIndex]);

  useEffect(() => refreshLabels(), [refreshLabels]);

  if (nodes.length === 0) {
    return <EmptyPane label="No active concept files are available for the graph." />;
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[560px] items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <AlertTriangle className="mx-auto size-6 text-amber-400" />
          <p className="mt-3 text-sm font-medium">Graph unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}. Use the tree and reader to continue browsing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[560px] overflow-hidden pt-16">
      <div ref={containerRef} className="absolute inset-0 top-16" aria-label="Interactive force-directed graph" />
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        <Button
          aria-label="Focus selected concept"
          disabled={selectedIndex < 0}
          onClick={() => frameSelectedOrFit(graphRef.current, selectedIndex, 350)}
          size="sm"
          title="Focus selected concept"
          variant="outline"
        >
          <Focus className="size-4" />Focus
        </Button>
        <Button
          aria-label="Fit graph in view"
          onClick={() => graphRef.current?.fitView(350, 0.22, false)}
          size="sm"
          title="Fit graph in view"
          variant="outline"
        >
          <Maximize2 className="size-4" />Fit
        </Button>
      </div>
      <div className="pointer-events-none absolute inset-0 top-16 overflow-hidden" aria-hidden="true">
        {labelIndices.map((index) => {
          const position = labelPositions.get(index);
          const node = nodes[index];
          if (!position || !node) return null;
          return (
            <span
              key={node.id}
              className={cn(
                "absolute max-w-40 -translate-x-1/2 translate-y-3 truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm",
                index === selectedIndex && "font-semibold text-foreground ring-1 ring-primary/60",
              )}
              style={{ left: position[0], top: position[1] }}
            >
              {node.title}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function GraphDetailPane({
  browseHref,
  document,
  isolatedNodes,
  onSelect,
}: {
  browseHref: string;
  document: OkfExplorerDocument | null;
  isolatedNodes: OkfExplorerNode[];
  onSelect: (filename: string) => void;
}) {
  if (!document || document.isReserved) {
    return (
      <aside className="min-h-0 overflow-auto border-t border-border bg-muted/10 p-5 lg:border-l lg:border-t-0">
        <Network className="size-5 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Select a concept</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a graph node to inspect its trust state, source, and typed relationships.</p>
        <UnconnectedConceptList className="mt-6" nodes={isolatedNodes} onSelect={onSelect} />
      </aside>
    );
  }
  const fileHref = `${browseHref}?file=${encodeURIComponent(document.filename)}`;
  return (
    <aside className="min-h-0 overflow-auto border-t border-border bg-muted/10 lg:border-l lg:border-t-0">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{document.type}</Badge><Badge variant="outline">{formatTrustStatus(document.trustStatus)}</Badge></div>
        <h2 className="mt-3 text-lg font-semibold">{document.title}</h2>
        {document.description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{document.description}</p> : null}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-muted-foreground">Source</dt><dd>{document.sourceFile ?? "Not specified"}</dd><dt className="text-muted-foreground">Pages</dt><dd>{formatPages(document.sourcePages)}</dd></dl>
        <Button asChild className="mt-4 w-full"><Link href={fileHref}><BookOpen />Read concept</Link></Button>
      </div>
      <CompactRelationList label="Outgoing" rows={document.outgoing.map((edge) => ({ file: edge.target, relation: edge.relation, title: edge.target.split("/").at(-1) ?? edge.target }))} onSelect={onSelect} />
      <CompactRelationList label="Incoming" rows={document.incoming.map((edge) => ({ file: edge.sourceFile, relation: edge.relation, title: edge.sourceTitle }))} onSelect={onSelect} />
      <UnconnectedConceptList nodes={isolatedNodes} onSelect={onSelect} />
    </aside>
  );
}

function UnconnectedConceptList({
  className,
  nodes,
  onSelect,
}: {
  className?: string;
  nodes: OkfExplorerNode[];
  onSelect: (filename: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <details className={cn("border-b border-border p-5", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase text-muted-foreground">
        <span>Unconnected concepts</span>
        <Badge variant="outline">{nodes.length}</Badge>
      </summary>
      <div className="mt-3 max-h-64 space-y-1 overflow-auto pr-1">
        {nodes.map((node) => (
          <button
            className="w-full border-l-2 border-border px-3 py-2 text-left hover:border-primary hover:bg-muted"
            key={node.id}
            onClick={() => onSelect(node.id)}
            type="button"
          >
            <span className="block truncate text-xs font-medium">{node.title}</span>
            <span className="mt-1 block text-[10px] uppercase text-muted-foreground">
              {node.type.replaceAll("_", " ")}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function CompactRelationList({ label, onSelect, rows }: {
  label: string;
  onSelect: (filename: string) => void;
  rows: Array<{ file: string; relation: string; title: string }>;
}) {
  return (
    <section className="border-b border-border p-5">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{label} relations</h3>
      <div className="mt-3 space-y-1">
        {rows.length ? rows.map((row) => <button className="w-full border-l-2 border-border px-3 py-2 text-left hover:border-primary hover:bg-muted" key={`${row.relation}-${row.file}`} onClick={() => onSelect(row.file)} type="button"><span className="block truncate text-xs font-medium">{row.title}</span><span className="mt-1 block text-[10px] uppercase text-primary">{row.relation.replaceAll("_", " ")}</span></button>) : <p className="text-xs text-muted-foreground">No {label.toLowerCase()} relations.</p>}
      </div>
    </section>
  );
}

function ExplorerReaderPane({
  document,
  files,
  issues,
  onSelect,
}: {
  document: OkfExplorerDocument | null;
  files: Array<{ filename: string; title: string }>;
  issues: OkfExplorerIssue[];
  onSelect: (filename: string) => void;
}) {
  if (!document) {
    return <EmptyPane label="Select a file to read its contents." />;
  }
  const documentIssues = issues.filter((issue) => issue.file === document.filename);

  return (
    <article className="h-full min-h-0 overflow-auto bg-background">
      <header className="border-b border-border px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {document.isReserved ? (
            <Badge variant="secondary">Reserved file</Badge>
          ) : (
            <>
              <Badge variant="secondary">{document.type}</Badge>
              <Badge variant="outline">{document.reviewStatus}</Badge>
            </>
          )}
          <Badge variant="outline">active</Badge>
          {!document.isReserved ? (
            <Badge variant={document.trustStatus === "agent_ready" ? "secondary" : "outline"}>
              {formatTrustStatus(document.trustStatus)}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-3 text-xl font-semibold">{document.title}</h2>
        {document.description && !document.descriptionRepeatedExactly ? <p className="mt-2 text-sm text-muted-foreground">{document.description}</p> : null}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">File</dt><dd className="truncate font-mono">{document.filename}</dd>
          {!document.isReserved ? (
            <>
              <dt className="text-muted-foreground">Source</dt><dd>{document.sourceFile ?? "Not specified"}</dd>
              <dt className="text-muted-foreground">Pages</dt><dd>{formatPages(document.sourcePages)}</dd>
            </>
          ) : null}
        </dl>
      </header>

      {documentIssues.length > 0 ? (
        <div className="border-b border-amber-400/20 bg-amber-400/5 px-5 py-3">
          {documentIssues.map((issue) => (
            <p className="flex gap-2 text-xs text-amber-300" key={`${issue.code}-${issue.relationIndex ?? "file"}`}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="px-5 py-5">
        <div className="okf-reader prose max-w-none text-sm leading-7 text-foreground/90 dark:prose-invert [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-xl [&_h2]:mt-7 [&_h2]:text-lg [&_h3]:text-base [&_table]:text-xs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...props }) => {
                const target = resolveReaderLink(document.filename, href, files.map((file) => file.filename));
                if (target.kind === "internal") {
                  return <button className="font-medium text-primary underline underline-offset-4" onClick={() => onSelect(target.filename)} type="button">{children}</button>;
                }
                if (target.kind === "broken") {
                  return <span className="cursor-not-allowed text-destructive line-through" title="Unresolved or unsafe bundle link">{children}</span>;
                }
                return <a {...props} href={href} rel="noreferrer" target="_blank">{children}</a>;
              },
            }}
          >
            {document.body}
          </ReactMarkdown>
        </div>
      </div>

      {!document.isReserved ? (
        <div className="grid gap-0 border-t border-border sm:grid-cols-2">
          <RelationModule
            emptyLabel="No outgoing typed relations."
            icon={ArrowUpRight}
            label="Outgoing relations"
            rows={document.outgoing.map((edge) => ({
              approvalMode: edge.approvalMode,
              file: edge.target,
              reason: edge.reason,
              relation: edge.relation,
              title: files.find((file) => file.filename === edge.target)?.title ?? "Missing target",
            }))}
            onSelect={onSelect}
          />
          <RelationModule
            emptyLabel="No incoming typed relations."
            icon={ArrowDownLeft}
            label="Incoming relations"
            rows={document.incoming.map((backlink) => ({
              approvalMode: backlink.approvalMode,
              file: backlink.sourceFile,
              reason: backlink.reason,
              relation: backlink.relation,
              title: backlink.sourceTitle,
            }))}
            onSelect={onSelect}
          />
        </div>
      ) : null}
    </article>
  );
}

function formatTrustStatus(value: OkfExplorerDocument["trustStatus"]) {
  if (value === "agent_ready") return "Approved agent-ready";
  if (value === "generic_valid") return "Valid generic OKF";
  if (value === "missing_trust_metadata") return "Valid OKF, missing trust metadata";
  if (value === "invalid_generic") return "Invalid generic OKF";
  return "Reserved file";
}

function RelationModule({
  emptyLabel,
  icon: Icon,
  label,
  onSelect,
  rows,
}: {
  emptyLabel: string;
  icon: typeof ArrowUpRight;
  label: string;
  onSelect: (filename: string) => void;
  rows: Array<{ approvalMode?: "automated" | "human" | null; file: string; reason: string; relation: string; title: string }>;
}) {
  return (
    <section className="border-b border-border p-4 sm:border-b-0 sm:border-r last:border-r-0">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Icon className="size-3.5" />{label}</h3>
      <div className="mt-3 space-y-2">
        {rows.length > 0 ? rows.map((row) => (
          <button
            type="button"
            key={`${row.relation}-${row.file}`}
            className="w-full border-l-2 border-border px-3 py-2 text-left outline-none transition-colors hover:border-primary hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(row.file)}
          >
            <span className="block truncate text-xs font-medium">{row.title}</span>
            <span className="mt-1 block text-[10px] uppercase text-primary">{row.relation.replaceAll("_", " ")}</span>
            {row.approvalMode === "automated" ? <span className="mt-1 block text-[10px] font-medium uppercase text-amber-600 dark:text-amber-300">Automation-verified relation</span> : null}
            <span className="mt-1 block text-xs text-muted-foreground">{row.reason}</span>
          </button>
        )) : <p className="text-xs text-muted-foreground">{emptyLabel}</p>}
      </div>
    </section>
  );
}

function EmptyPane({ label }: { label: string }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div><BookOpen className="mx-auto mb-3 size-5" />{label}</div>
    </div>
  );
}

function filterTree(tree: OkfTreeNode[], query: string): OkfTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tree;
  return tree.flatMap((node) => {
    if (node.kind === "file") {
      return node.label.toLowerCase().includes(normalized) || node.id.toLowerCase().includes(normalized)
        ? [node]
        : [];
    }
    const children = filterTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function resolveReaderLink(sourceFile: string, href: string | undefined, files: string[]) {
  if (!href) return { kind: "broken" as const };
  if (/^https?:\/\//i.test(href)) return { kind: "external" as const };
  if (href.includes("\\") || href.includes("?") || href.startsWith("/")) return { kind: "broken" as const };
  const [rawPath] = href.split("#");
  if (!rawPath?.endsWith(".md")) return { kind: "broken" as const };
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return { kind: "broken" as const }; }
  const parts = [...sourceFile.split("/").slice(0, -1), ...decoded.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return { kind: "broken" as const };
      normalized.pop();
    } else normalized.push(part);
  }
  const filename = normalized.join("/");
  return files.includes(filename)
    ? { filename, kind: "internal" as const }
    : { kind: "broken" as const };
}

function colorForType(type: string): number[] {
  const colors: Record<string, number[]> = {
    dispatch_reference: [0.96, 0.62, 0.16, 1],
    fault_route: [0.95, 0.31, 0.35, 1],
    routing_rule: [0.62, 0.43, 0.95, 1],
    system_topic: [0.17, 0.73, 0.55, 1],
  };
  return colors[type] ?? [0.34, 0.64, 0.95, 1];
}

function frameSelectedOrFit(graph: GraphInstance | null, selectedIndex: number, duration: number) {
  if (!graph) return;
  if (selectedIndex >= 0) {
    graph.zoomToPointByIndex(selectedIndex, duration, 2.2, false, false);
    return;
  }
  graph.fitView(duration, 0.22, false);
}

function formatPages(pages: number[]) {
  if (pages.length === 0) return "Not specified";
  if (pages.length === 1) return `${pages[0]}`;
  return `${Math.min(...pages)}-${Math.max(...pages)}`;
}
