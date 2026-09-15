import type {
  EntityGraphEdge,
  EntityGraphNode,
} from "./entity-graph-view.ts";

export function filterEntityGraphByEntityIds(input: {
  edges: EntityGraphEdge[];
  nodes: EntityGraphNode[];
  selectedEntityIds: Iterable<string>;
}): { edges: EntityGraphEdge[]; nodes: EntityGraphNode[] } {
  const availableEntityIds = new Set(
    input.nodes.filter((node) => node.kind === "entity").map((node) => node.id),
  );
  const selectedEntityIds = new Set(
    [...input.selectedEntityIds].filter((id) => availableEntityIds.has(id)),
  );
  if (selectedEntityIds.size === 0) return { edges: [], nodes: [] };

  const visibleNodeIds = new Set(selectedEntityIds);
  for (const edge of input.edges) {
    if (selectedEntityIds.has(edge.source) || selectedEntityIds.has(edge.target)) {
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    }
  }

  const edges = input.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );
  const degreeById = new Map<string, number>();
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }
  const nodes = input.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => ({ ...node, degree: degreeById.get(node.id) ?? 0 }));

  return { edges, nodes };
}
