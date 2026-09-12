import { performance } from "node:perf_hooks";
import { detectGraphCommunities, projectGraphCommunities } from "../src/lib/graph-communities.ts";
import type { OkfExplorerNode, OkfExplorerEdge } from "../src/lib/okf-explorer.ts";

// Deterministic synthetic workloads; measures grouping, not WebGL frame rate.
const results = [];
for (const count of [228, 2738, 10000]) {
  const nodes: OkfExplorerNode[] = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`, title: `Concept ${index}`, type: "system_topic", degree: 8,
    reviewStatus: "approved", sourceFile: null, sourcePages: [],
  }));
  const edges: OkfExplorerEdge[] = nodes.flatMap((node, index) => [1, 2, 7, 31].map((offset) => ({
    id: `${index}-${offset}`, source: node.id, target: nodes[(index + offset) % count].id,
    relation: "references", reason: "Synthetic benchmark",
  })));
  const measurements = [];
  let groups = 0;
  let visibleEdges = 0;
  for (let run = 0; run < 6; run++) {
    const start = performance.now();
    const communities = detectGraphCommunities(nodes, edges);
    const projection = projectGraphCommunities(nodes, edges, communities, new Set());
    const milliseconds = performance.now() - start;
    if (run) measurements.push(milliseconds);
    groups = projection.nodes.length;
    visibleEdges = projection.edges.length;
  }
  measurements.sort((a, b) => a - b);
  results.push({ nodes: count, edges: edges.length, visibleGroups: groups, visibleEdges,
    medianMilliseconds: Math.round(measurements[2]), maxMilliseconds: Math.round(measurements[4]) });
}
console.log(JSON.stringify({ runtime: process.version, kind: "synthetic-node-cpu-not-browser-rendering", results }, null, 2));
