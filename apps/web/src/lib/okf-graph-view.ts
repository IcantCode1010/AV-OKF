import type { OkfExplorerEdge, OkfExplorerNode } from "./okf-explorer";

export type OkfGraphViewMode = "neighborhood" | "all";

export type OkfGraphView = {
  edges: OkfExplorerEdge[];
  focusFile: string | null;
  isolatedNodes: OkfExplorerNode[];
  nodes: OkfExplorerNode[];
};

export function getDefaultOkfGraphViewMode(
  edges: OkfExplorerEdge[],
): OkfGraphViewMode {
  return edges.length === 0 ? "all" : "neighborhood";
}

export function buildOkfGraphView(input: {
  edges: OkfExplorerEdge[];
  mode: OkfGraphViewMode;
  nodes: OkfExplorerNode[];
  selectedFile: string | null;
}): OkfGraphView {
  const isolatedNodes = input.nodes
    .filter((node) => node.degree === 0)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const focusFile = input.nodes.some((node) => node.id === input.selectedFile)
    ? input.selectedFile
    : [...input.nodes].sort(
        (a, b) =>
          b.degree - a.degree ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      )[0]?.id ?? null;

  if (input.mode === "all" || !focusFile) {
    return { edges: input.edges, focusFile, isolatedNodes, nodes: input.nodes };
  }

  const visibleIds = new Set([focusFile]);
  for (const edge of input.edges) {
    if (edge.source === focusFile) visibleIds.add(edge.target);
    if (edge.target === focusFile) visibleIds.add(edge.source);
  }

  return {
    edges: input.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    ),
    focusFile,
    isolatedNodes,
    nodes: input.nodes.filter((node) => visibleIds.has(node.id)),
  };
}
