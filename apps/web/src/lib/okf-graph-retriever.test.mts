import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { traverseOkfRelations } from "./okf-graph-retriever.ts";

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
      'review_status: "approved"',
      `title: "${title}"`,
      `description: "Approved ${title} concept."`,
      'source_file: "Manual"',
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
