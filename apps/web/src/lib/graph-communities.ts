import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type { OkfExplorerEdge, OkfExplorerNode } from "./okf-explorer.ts";

export type GraphCommunity = { id: string; title: string; memberIds: string[]; kind?: "unlinked" };
export type CommunityNode = OkfExplorerNode & { memberIds?: string[] };

/** Communities describe connectivity, not verified semantic categories. */
export function detectGraphCommunities(nodes: OkfExplorerNode[], edges: OkfExplorerEdge[]): GraphCommunity[] {
  const graph = new UndirectedGraph();
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  sorted.forEach((node) => graph.addNode(node.id));
  const links = edges.filter((edge) => edge.source !== edge.target && graph.hasNode(edge.source) && graph.hasNode(edge.target))
    .map((edge) => [edge.source, edge.target].sort())
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  links.forEach(([source, target]) => { if (!graph.hasEdge(source, target)) graph.addEdge(source, target); });
  if (!nodes.length) return [];
  const membership = graph.size ? louvain(graph, { randomWalk: false, getEdgeWeight: null })
    : Object.fromEntries(sorted.map((node, index) => [node.id, index]));
  const groups = new Map<number, OkfExplorerNode[]>();
  sorted.forEach((node) => { const group = groups.get(membership[node.id]) ?? []; group.push(node); groups.set(membership[node.id], group); });
  const isolated = sorted.filter((node) => graph.degree(node.id) === 0);
  const connected = [...groups.values()].filter((members) => graph.degree(members[0].id) > 0).map((members) => {
    const representative = [...members].sort((a, b) => graph.degree(b.id) - graph.degree(a.id) || a.id.localeCompare(b.id))[0];
    let id = `community:${members[0].id}`;
    while (graph.hasNode(id)) id = `_${id}`;
    return { id, title: representative.title, memberIds: members.map((node) => node.id) };
  }).sort((a, b) => b.memberIds.length - a.memberIds.length || a.id.localeCompare(b.id));
  if (isolated.length) {
    let id = "community:unlinked";
    while (graph.hasNode(id)) id = `_${id}`;
    return [...connected, { id, title: "Unlinked concepts", memberIds: isolated.map((node) => node.id), kind: "unlinked" }];
  }
  return connected;
}

export function projectGraphCommunities(nodes: OkfExplorerNode[], edges: OkfExplorerEdge[], communities: GraphCommunity[], expanded: ReadonlySet<string>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const displayedId = new Map<string, string>();
  const projectedNodes: CommunityNode[] = [];
  for (const community of communities) {
    const members = community.memberIds.filter((id) => byId.has(id));
    if (members.length <= 1 || expanded.has(community.id)) {
      members.forEach((id) => { projectedNodes.push(byId.get(id)!); displayedId.set(id, id); });
    } else {
      members.forEach((id) => displayedId.set(id, community.id));
      projectedNodes.push({ id: community.id, title: `${community.title} · ${members.length} nodes`,
        type: community.kind === "unlinked" ? "unlinked_group" : byId.get(members[0])!.type, degree: members.length, reviewStatus: "connectivity_group",
        sourceFile: null, sourcePages: [], memberIds: members });
    }
  }
  const buckets = new Map<string, { source: string; target: string; relation: string; edges: OkfExplorerEdge[] }>();
  for (const edge of edges) {
    const source = displayedId.get(edge.source), target = displayedId.get(edge.target);
    if (!source || !target || (source === target && source !== edge.source)) continue;
    const key = JSON.stringify([source, target, edge.relation]);
    const bucket = buckets.get(key) ?? { source, target, relation: edge.relation, edges: [] };
    bucket.edges.push(edge); buckets.set(key, bucket);
  }
  const projectedEdges: OkfExplorerEdge[] = [...buckets.values()].flatMap((bucket, index) => {
    if (bucket.edges.every((edge) => edge.source === bucket.source && edge.target === bucket.target)) return bucket.edges;
    return [{ id: `community-edge:${index}`, source: bucket.source, target: bucket.target, relation: bucket.relation,
      reason: `${bucket.edges.length} ${bucket.relation.replaceAll("_", " ")} connection${bucket.edges.length === 1 ? "" : "s"} between members of these groups. Expand the groups to inspect individual assertions and their evidence.` }];
  });
  return { nodes: projectedNodes, edges: projectedEdges };
}
