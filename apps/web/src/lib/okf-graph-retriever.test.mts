import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { traverseOkfRelations } from "./okf-graph-retriever.ts";
import { publishedGraphResult } from "./knowledge/published-graph-result.ts";
import { buildIncomingOkfIndex } from "./okf-graph-index.ts";

test("scoped reverse index reads its inventory directly and excludes linked directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-scoped-index-"));
  try {
    await mkdir(path.join(root, "topics"));
    await writeTopic(root, "topics/a.md", "A", [relation("references", "b.md")]);
    await writeTopic(root, "topics/b.md", "B", []);
    await symlink(path.join(root, "topics"), path.join(root, "linked"), "junction");
    const input = { knowledgeBundleId: "bundle", knowledgeRoot: root, workspaceId: "wrk_1", seedFiles: ["topics/b.md"],
      allowedFiles: ["linked/a.md", "topics/a.md", "topics/b.md", "../outside.md"] };
    const result = await buildIncomingOkfIndex(input, Date.now() + 5000, 10);
    assert.equal(result.scanned, 2);
    assert.deepEqual(result.incoming.get("topics/b.md")?.map((link) => link.sourceFile), ["topics/a.md"]);
    assert.deepEqual(result.warnings, []);
    const empty = await buildIncomingOkfIndex({ ...input, knowledgeRoot: path.join(root, "topics/a.md"), allowedFiles: [] }, Date.now() + 5000, 10);
    assert.equal(empty.scanned, 0); // No directory open: the supplied root is deliberately a file.
    const limited = await buildIncomingOkfIndex(input, Date.now() + 5000, 1);
    assert.equal(limited.scanned, 1);
    assert.ok(limited.warnings.includes("graph_index_file_budget_exhausted"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent projection retains validated seeds and actual incoming traversal paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-agent-path-"));
  try {
    await writeTopic(root, "a.md", "A", [relation("references", "b.md")]);
    await writeTopic(root, "b.md", "B", []);
    const topics = ["a", "b"].map((id) => ({ id, exportedFilePath: `${id}.md`, title: id,
      documentId: "manual", sourcePageNumbers: [1] }));
    const graph = await traverseOkfRelations({ knowledgeBundleId: "bundle", knowledgeRoot: root,
      workspaceId: "wrk_1", seedFiles: ["b.md"], allowedFiles: ["a.md", "b.md"], direction: "incoming", relationTypes: [], maxHops: 1 });
    assert.deepEqual(graph.concepts.map((concept) => concept.filePath), ["a.md"]);
    const result = publishedGraphResult(topics, graph);
    assert.deepEqual(result.nodes.map((node) => node.id), ["a", "b"]);
    assert.deepEqual(result.paths[0].connections, [{ sourceTopicId: "a", targetTopicId: "b", relation: "references" }]);
    assert.ok(!result.warnings.includes("graph_path_unavailable"));
    const isolated = await traverseOkfRelations({ knowledgeBundleId: "bundle", knowledgeRoot: root,
      workspaceId: "wrk_1", seedFiles: ["b.md"], direction: "outgoing" });
    assert.deepEqual(publishedGraphResult(topics, isolated).nodes.map((node) => node.id), ["b"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("traverses approved OKF relations with a bounded hop count", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-"));

  try {
    await writeTopic(root, "system.md", "System", [
      relation("references", "procedure.md"),
    ]);
    await writeTopic(root, "procedure.md", "Procedure", [
      relation("routes_to", "limit.md"),
    ]);
    await writeTopic(root, "limit.md", "Limit", []);

    const result = await traverseOkfRelations({
      knowledgeRoot: root,
      maxHops: 2,
      seedFiles: ["system.md"],
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      result.concepts.map((concept) => concept.filePath),
      ["limit.md", "procedure.md"],
    );
    assert.deepEqual(result.paths, [
      {
        files: ["system.md", "procedure.md"],
        relationTypes: ["references"],
      },
      {
        files: ["system.md", "procedure.md", "limit.md"],
        relationTypes: ["references", "routes_to"],
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("skips cycles and enforces the traversal boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-cycle-"));

  try {
    await writeTopic(root, "a.md", "A", [relation("references", "b.md")]);
    await writeTopic(root, "b.md", "B", [relation("references", "a.md")]);

    const result = await traverseOkfRelations({
      knowledgeRoot: root,
      maxHops: 3,
      seedFiles: ["a.md"],
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result.concepts.map((concept) => concept.filePath), ["b.md"]);
    assert.ok(result.warnings.includes("graph_cycle_skipped:a.md"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("excludes inactive or unsafe relation targets without failing chat retrieval", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-safe-"));

  try {
    await writeTopic(root, "system.md", "System", [
      relation("references", "../outside.md"),
      relation("references", "archived.md"),
    ]);
    await writeTopic(root, "archived.md", "Archived", []);

    const result = await traverseOkfRelations({
      knowledgeRoot: root,
      lifecycleLookup: async ({ filePath }) =>
        filePath === "archived.md" ? { status: "archived" } : null,
      seedFiles: ["system.md"],
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result.concepts, []);
    assert.ok(result.warnings.includes("graph_relation_target_invalid:system.md:0"));
    assert.ok(result.warnings.includes("graph_relation_target_unavailable:archived.md"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("skips a relation whose declared target type disagrees with frontmatter", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-type-"));

  try {
    await writeTopic(root, "system.md", "System", [
      relationWithType("references", "procedure.md", "fault_route"),
    ]);
    await writeTopic(root, "procedure.md", "Procedure", []);

    const result = await traverseOkfRelations({
      knowledgeRoot: root,
      seedFiles: ["system.md"],
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result.concepts, []);
    assert.ok(
      result.warnings.includes("graph_relation_target_type_mismatch:system.md:0"),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("expands converging nodes at shortest depth and retains alternate paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-breadth-"));
  try {
    await writeTopic(root, "a.md", "A", [relation("references", "b.md"), relation("references", "c.md")]);
    await writeTopic(root, "b.md", "B", [relation("references", "c.md")]);
    await writeTopic(root, "c.md", "C", [relation("references", "d.md")]);
    await writeTopic(root, "d.md", "D", []);
    const result = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1", seedFiles: ["a.md"], maxHops: 2 });
    assert.deepEqual(result.concepts.map((node) => node.filePath), ["b.md", "c.md", "d.md"]);
    assert.ok(result.paths.some((entry) => entry.files.join(",") === "a.md,b.md,c.md"));
    assert.ok(result.paths.some((entry) => entry.files.join(",") === "a.md,c.md,d.md"));
    assert.ok(!result.warnings.includes("graph_cycle_skipped:c.md"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("node and edge budgets return partial evidence with explicit warnings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-budget-"));
  try {
    await writeTopic(root, "a.md", "A", [relation("references", "b.md"), relation("references", "c.md")]);
    await writeTopic(root, "b.md", "B", []);
    await writeTopic(root, "c.md", "C", []);
    const input = { knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1", seedFiles: ["a.md"] };
    const nodes = await traverseOkfRelations({ ...input, maxNodes: 2 });
    assert.deepEqual(nodes.concepts.map((node) => node.filePath), ["b.md"]);
    assert.ok(nodes.warnings.includes("graph_node_budget_exhausted"));
    const edges = await traverseOkfRelations({ ...input, maxEdges: 1 });
    assert.deepEqual(edges.concepts.map((node) => node.filePath), ["b.md"]);
    assert.ok(edges.warnings.includes("graph_edge_budget_exhausted"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("incoming published traversal preserves assertion direction and excludes inactive sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-incoming-"));
  try {
    await writeTopic(root, "supply.md", "Supply", [relation("references", "actuator.md")]);
    await writeTopic(root, "inactive.md", "Inactive", [relation("references", "actuator.md")]);
    await writeTopic(root, "actuator.md", "Actuator", []);
    const result = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1",
      seedFiles: ["actuator.md"], direction: "incoming", maxHops: 1,
      lifecycleLookup: async ({ filePath }) => filePath === "inactive.md" ? { status: "archived" } : null,
    });
    assert.deepEqual(result.concepts.map((node) => node.filePath), ["supply.md"]);
    assert.deepEqual(result.paths, [{ files: ["actuator.md", "supply.md"], relationTypes: ["references"], directions: ["incoming"] }]);
    const filtered = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1", seedFiles: ["actuator.md"], direction: "both", relationTypes: ["routes_to"] });
    assert.deepEqual(filtered.paths, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("incoming index reports partial discovery when its file budget is reached", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-index-budget-"));
  try {
    await writeTopic(root, "a.md", "A", []);
    await writeTopic(root, "b.md", "B", []);
    const result = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1", seedFiles: ["a.md"], direction: "both", maxIndexFiles: 1 });
    assert.ok(result.warnings.includes("graph_index_file_budget_exhausted"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit source scope blocks outgoing targets and incoming sources before evidence inspection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-scope-"));
  try {
    await writeTopic(root, "allowed.md", "Allowed", [relation("references", "private.md")]);
    await writeTopic(root, "private.md", "Private", [relation("references", "allowed.md")]);
    const inspected: string[] = [];
    const result = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1",
      seedFiles: ["allowed.md"], allowedFiles: ["allowed.md"], direction: "both",
      lifecycleLookup: async ({ filePath }) => { inspected.push(filePath); return null; },
    });
    assert.deepEqual(result.concepts, []);
    assert.deepEqual(result.paths, []);
    assert.ok(result.warnings.includes("graph_target_outside_scope"));
    assert.ok(inspected.length > 0);
    assert.ok(inspected.every((file) => file === "allowed.md"));
    assert.ok(!JSON.stringify(result).includes("private.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reverse discovery does not inspect the bundle without an accessible seed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-graph-no-seed-"));
  try {
    await writeTopic(root, "private.md", "Private", []);
    let inspected = 0;
    const result = await traverseOkfRelations({ knowledgeRoot: root, knowledgeBundleId: "kb_test", workspaceId: "wrk_1",
      seedFiles: ["private.md"], allowedFiles: [], direction: "both",
      lifecycleLookup: async () => { inspected++; return null; },
    });
    assert.equal(inspected, 0);
    assert.deepEqual(result.paths, []);
    assert.deepEqual(result.warnings, ["graph_seed_outside_scope"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function relation(relationType: string, target: string): string {
  return relationWithType(relationType, target, "system_topic");
}

function relationWithType(
  relationType: string,
  target: string,
  targetType: string,
): string {
  return [
    "  - relation: \"" + relationType + "\"",
    "    target: \"" + target + "\"",
    `    target_type: "${targetType}"`,
    '    reason: "Related approved concept."',
  ].join("\n");
}

async function writeTopic(
  root: string,
  filename: string,
  title: string,
  relations: string[],
): Promise<void> {
  await writeFile(
    path.join(root, filename),
    [
      "---",
      'type: "system_topic"',
      'status: "stable"',
      `title: "${title}"`,
      `description: "Approved ${title} concept."`,
      "verified:",
      '  - by: "human:test-reviewer"',
      '    at: "2026-07-20T12:00:00.000Z"',
      "sources:",
      '  - resource: "/references/sources/manual.md"',
      '    title: "Manual"',
      "source_pages:",
      "  - 1",
      ...(relations.length > 0 ? ["relations:", ...relations] : []),
      "---",
      "",
      `${title} details.`,
    ].join("\n"),
    "utf8",
  );
}
