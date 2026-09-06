import assert from "node:assert/strict";
import test from "node:test";
import { detectGraphCommunities, projectGraphCommunities } from "./graph-communities.ts";
import type { OkfExplorerNode, OkfExplorerEdge } from "./okf-explorer.ts";

const nodes: OkfExplorerNode[] = Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: `Concept ${index}`, type: "system_topic", degree: 4, reviewStatus: "approved", sourceFile: "manual.md", sourcePages: [1] }));
const edges: OkfExplorerEdge[] = [];
for (let start = 0; start < 10; start += 5) {
  for (let source = start; source < start + 5; source++) {
    for (let target = source + 1; target < start + 5; target++) {
      edges.push({ id: `${source}-${target}`, source: String(source), target: String(target), relation: "references", reason: "Original evidence" });
    }
  }
}
edges.push({ id: "bridge", source: "4", target: "5", relation: "depends_on", reason: "Bridge evidence" });

test("dense neighborhoods form stable groups independent of input ordering", () => {
  const groups = detectGraphCommunities(nodes, edges);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.memberIds.length), [5, 5]);
  assert.deepEqual(detectGraphCommunities([...nodes].reverse(), [...edges].reverse()), groups);
});

test("collapsing reduces clutter and full expansion restores every original directed assertion", () => {
  const groups = detectGraphCommunities(nodes, edges);
  const collapsed = projectGraphCommunities(nodes, edges, groups, new Set());
  assert.equal(collapsed.nodes.length, 2);
  assert.equal(collapsed.edges.length, 1);
  assert.equal(collapsed.edges[0].relation, "depends_on");
  assert.equal(collapsed.edges[0].source, groups.find((group) => group.memberIds.includes("4"))!.id);
  assert.equal(collapsed.edges[0].target, groups.find((group) => group.memberIds.includes("5"))!.id);
  const expanded = projectGraphCommunities(nodes, edges, groups, new Set(groups.map((group) => group.id)));
  assert.deepEqual(expanded.nodes.map((node) => node.id).sort(), nodes.map((node) => node.id).sort());
  assert.deepEqual([...expanded.edges].sort((a, b) => a.id.localeCompare(b.id)), [...edges].sort((a, b) => a.id.localeCompare(b.id)));
});

test("isolated nodes stay available in an explicitly unlinked browsing group", () => {
  const groups = detectGraphCommunities(nodes.slice(0, 2), [{ ...edges[0], target: "missing" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "unlinked");
  const view = projectGraphCommunities(nodes.slice(0, 2), [], groups, new Set());
  assert.equal(view.nodes.length, 1);
  assert.deepEqual(view.nodes[0].memberIds, ["0", "1"]);
  assert.equal(view.edges.length, 0);
  const expanded = projectGraphCommunities(nodes.slice(0, 2), [], groups, new Set([groups[0].id]));
  assert.equal(expanded.nodes.length, 2);
  assert.deepEqual(detectGraphCommunities([], []), []);
});
