import type { EntityGraphEdge, EntityGraphNode } from "./entity-graph-view.ts";

export type EntityGraphLayer = "all" | "knowledge" | "evidence" | "review";

export function filterEntityGraphLayer(input: { nodes: EntityGraphNode[]; edges: EntityGraphEdge[] }, layer: EntityGraphLayer) {
  if (layer === "all") return input;
  const edges = input.edges.filter((edge) => layer === "knowledge" ? edge.status === "published"
    : layer === "evidence" ? edge.status === "structural"
    : edge.status !== "published" && edge.status !== "structural");
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return { nodes: input.nodes.filter((node) => connected.has(node.id)), edges };
}
