import type { OkfExplorerEdge, OkfExplorerNode } from "./okf-explorer";

export type OkfGraphViewMode = "neighborhood" | "all";

export type OkfGraphView = {
  edges: OkfExplorerEdge[];
  focusFile: string | null;
  isolatedNodes: OkfExplorerNode[];
  nodes: OkfExplorerNode[];
};

export type OkfGraphFocus = {
  highlightedLinkIndices: number[];
  highlightedPointIndices: number[];
  selectedIndex: number;
};

export function buildOkfGraphFocus(input: {
  edges: OkfExplorerEdge[];
  nodes: OkfExplorerNode[];
  selectedFile: string | null;
}): OkfGraphFocus {
  const indexById = new Map(input.nodes.map((node, index) => [node.id, index]));
  const selectedIndex = input.selectedFile === null
    ? -1
    : indexById.get(input.selectedFile) ?? -1;
  if (selectedIndex < 0 || input.selectedFile === null) {
    return { highlightedLinkIndices: [], highlightedPointIndices: [], selectedIndex: -1 };
  }

  const highlightedPointIndices = new Set([selectedIndex]);
  const highlightedLinkIndices: number[] = [];
  input.edges.forEach((edge, index) => {
    if (edge.source !== input.selectedFile && edge.target !== input.selectedFile) return;
    highlightedLinkIndices.push(index);
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    if (sourceIndex !== undefined) highlightedPointIndices.add(sourceIndex);
    if (targetIndex !== undefined) highlightedPointIndices.add(targetIndex);
  });

  return {
    highlightedLinkIndices,
    highlightedPointIndices: [...highlightedPointIndices].sort((a, b) => a - b),
    selectedIndex,
  };
}

export function getDefaultOkfGraphViewMode(): OkfGraphViewMode {
  // Start with the whole map; large 3D maps collapse into navigable groups.
  return "all";
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
