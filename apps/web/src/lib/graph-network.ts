import type { EntityGraphEdge, EntityGraphNode, EntityGraphSnapshot } from "./entity-graph-view.ts";
import type { OkfExplorerEdge, OkfExplorerNode } from "./okf-explorer.ts";
import { normalizeOkfTopicFilePath } from "./okf-topic-routing.ts";

export type NetworkNode = EntityGraphNode & { aliases: string[] };
export type NetworkEdge = EntityGraphEdge & { evidence: EntityGraphEdge[]; count: number };
export type GraphNetwork = { nodes: NetworkNode[]; edges: NetworkEdge[]; attentionCount: number };

// This is a display projection. It never merges entity identities or creates
// semantic assertions from co-occurrence, names, or matching entity types.
export function buildGraphNetwork(input: {
  entities: EntityGraphSnapshot;
  published: { nodes: OkfExplorerNode[]; edges: OkfExplorerEdge[] };
}): GraphNetwork {
  const nodes = new Map<string, NetworkNode>();
  const entityNodes = new Map(input.entities.nodes.map((node) => [node.id, node]));
  const remap = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const node of input.entities.nodes) {
    const path = normalizeOkfTopicFilePath(node.exportedFilePath);
    if (path) byPath.set(path, node.id);
  }
  for (const node of input.entities.nodes) {
    if (node.kind !== "alias") nodes.set(node.id, { ...node, degree: 0, aliases: [] });
  }
  for (const node of input.published.nodes) {
    const id = byPath.get(node.id) ?? `okf:${node.id}`;
    remap.set(node.id, id);
    nodes.set(id, { id, degree: 0, kind: "topic", status: node.reviewStatus,
      title: node.title, type: "concept", aliases: [], exportedFilePath: node.id });
  }
  for (const edge of input.entities.edges) {
    if (edge.relation !== "alias_of" || edge.status !== "structural") continue;
    const alias = entityNodes.get(edge.source);
    if (alias?.status === "accepted") nodes.get(edge.target)?.aliases.push(alias.title);
  }
  const edges = new Map<string, NetworkEdge>();
  const addEdge = (edge: EntityGraphEdge) => {
    if (edge.source === edge.target || !nodes.has(edge.source) || !nodes.has(edge.target)) return;
    const key = JSON.stringify([edge.source, edge.target, edge.relation, edge.status]);
    const existing = edges.get(key);
    if (existing) {
      existing.count++;
      existing.evidence.push(edge);
      existing.pages = [...new Set([...existing.pages, ...edge.pages])].sort((a, b) => a - b);
    } else edges.set(key, { ...edge, pages: [...edge.pages], evidence: [edge], count: 1 });
  };
  const publishedKeys = new Set<string>();
  for (const edge of input.published.edges) {
    const source = remap.get(edge.source);
    const target = remap.get(edge.target);
    if (!source || !target) continue;
    publishedKeys.add(JSON.stringify([source, target, edge.relation]));
    addEdge({ ...edge, source, target, status: "published", pages: [] });
  }
  for (const edge of input.entities.edges) {
    if (edge.status === "published" && publishedKeys.has(JSON.stringify([edge.source, edge.target, edge.relation]))) {
      const stored = edges.get(JSON.stringify([edge.source, edge.target, edge.relation, "published"]));
      if (stored) { stored.evidence.push(edge); stored.pages = [...new Set([...stored.pages, ...edge.pages])]; }
    } else if (edge.status !== "published") addEdge(edge);
  }
  for (const edge of edges.values()) {
    nodes.get(edge.source)!.degree++;
    nodes.get(edge.target)!.degree++;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()],
    attentionCount: [...edges.values()].filter((edge) => edge.status !== "published" && edge.status !== "structural").length };
}

export type NetworkScope = "network" | "published" | "attention";
export function selectGraphNetwork(network: GraphNetwork, scope: NetworkScope, hiddenTypes: ReadonlySet<string> = new Set()) {
  const eligibleEdges = network.edges.filter((edge) => scope === "network"
    ? edge.status === "structural" || edge.status === "published"
    : scope === "published" ? edge.status === "published" : edge.status !== "published" && edge.status !== "structural");
  const linked = new Set(eligibleEdges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = network.nodes.filter((node) => !hiddenTypes.has(node.type) &&
    (scope === "network" ? node.type !== "unresolved" : scope === "published" ? Boolean(node.exportedFilePath) : linked.has(node.id)));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = eligibleEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return { nodes: nodes.map((node) => ({ ...node, degree: degrees.get(node.id) ?? 0 })), edges };
}
