import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOkfExplorerSnapshot } from "./okf-explorer.ts";
import { listOkfBundleFiles } from "./okf-bundle.ts";

test("physical nested paths build a directory-first tree and reserved files stay out of graph", async () => {
  await withFixture(async (root) => {
    await writeTopic(root, "index.md", { title: "Bundle Index", type: "index" });
    await writeTopic(root, "systems/brakes.md", { title: "Brakes" });
    await writeTopic(root, "systems/hydraulics/pump.md", { title: "Pump" });
    const snapshot = await buildSnapshot(root);

    assert.deepEqual(snapshot.tree.map((node) => [node.kind, node.label]), [
      ["directory", "systems"],
      ["file", "index.md"],
    ]);
    assert.deepEqual(snapshot.tree[0]?.children.map((node) => node.label), [
      "hydraulics",
      "brakes.md",
    ]);
    assert.equal(snapshot.nodes.some((node) => node.id === "index.md"), false);
    assert.equal(snapshot.files.some((file) => file.filename === "index.md"), true);
  });
});

test("typed relations produce deterministic edges, backlinks, and degree", async () => {
  await withFixture(async (root) => {
    await writeTopic(root, "systems/a.md", {
      relations: [
        {
          reason: "B supports A",
          relation: "references",
          target: "b.md",
          targetType: "system_topic",
        },
      ],
      title: "A",
    });
    await writeTopic(root, "systems/b.md", { title: "B" });
    const snapshot = await buildSnapshot(root, "systems/b.md");

    assert.deepEqual(snapshot.edges, [
      {
        id: "systems/a.md::0::systems/b.md",
        reason: "B supports A",
        relation: "references",
        source: "systems/a.md",
        target: "systems/b.md",
      },
    ]);
    assert.equal(snapshot.nodes.find((node) => node.id === "systems/a.md")?.degree, 1);
    assert.equal(snapshot.nodes.find((node) => node.id === "systems/b.md")?.degree, 1);
    assert.deepEqual(snapshot.selectedDocument?.incoming, [
      {
        reason: "B supports A",
        relation: "references",
        sourceFile: "systems/a.md",
        sourceTitle: "A",
      },
    ]);
  });
});

test("inactive files and edges targeting them are excluded", async () => {
  await withFixture(async (root) => {
    await writeTopic(root, "active.md", {
      relations: [
        {
          reason: "Historical context",
          relation: "references",
          target: "archived.md",
          targetType: "system_topic",
        },
      ],
      title: "Active",
    });
    await writeTopic(root, "archived.md", { title: "Archived" });
    const bundleFiles = await listOkfBundleFiles(root);
    const snapshot = await buildOkfExplorerSnapshot({
      allowedRelations: ["references"],
      bundleFiles,
      knowledgeRoot: root,
      lifecycleByFile: new Map([
        ["archived.md", { reason: "Old", status: "archived" }],
      ]),
    });

    assert.deepEqual(snapshot.files.map((file) => file.filename), ["active.md"]);
    assert.equal(snapshot.edges.length, 0);
    assert.equal(snapshot.issues[0]?.code, "relation_target_inactive");
  });
});

test("broken, escaping, and type-mismatched relation targets produce warnings", async () => {
  await withFixture(async (root) => {
    await writeTopic(root, "target.md", { title: "Target", type: "fault_route" });
    await writeTopic(root, "source.md", {
      relations: [
        {
          reason: "Missing",
          relation: "references",
          target: "missing.md",
          targetType: "system_topic",
        },
        {
          reason: "Escape",
          relation: "references",
          target: "../outside.md",
          targetType: "system_topic",
        },
        {
          reason: "Wrong type",
          relation: "references",
          target: "target.md",
          targetType: "system_topic",
        },
      ],
      title: "Source",
    });
    const snapshot = await buildSnapshot(root);

    assert.deepEqual(
      snapshot.issues.map((issue) => issue.code),
      [
        "relation_target_missing",
        "relation_target_invalid",
        "relation_target_type_mismatch",
      ],
    );
    assert.equal(snapshot.edges.length, 0);
  });
});

test("invalid and inactive selections fall back to index then first active concept", async () => {
  await withFixture(async (root) => {
    await writeTopic(root, "index.md", { title: "Index", type: "index" });
    await writeTopic(root, "topic.md", { title: "Topic" });

    assert.equal((await buildSnapshot(root, "../outside.md")).selectedFile, "index.md");

    await rm(path.join(root, "index.md"));
    assert.equal((await buildSnapshot(root, "missing.md")).selectedFile, "topic.md");
  });
});

test("unparseable files remain in the tree with a warning but not in the graph", async () => {
  await withFixture(async (root) => {
    await writeFile(path.join(root, "notes.md"), "No frontmatter here.", "utf8");
    const snapshot = await buildSnapshot(root);

    assert.equal(snapshot.files[0]?.filename, "notes.md");
    assert.equal(snapshot.nodes.length, 0);
    assert.equal(snapshot.issues[0]?.code, "file_unparseable");
  });
});

async function buildSnapshot(root: string, requestedFile?: string) {
  return buildOkfExplorerSnapshot({
    allowedRelations: ["references"],
    knowledgeRoot: root,
    requestedFile,
  });
}

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-explorer-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeTopic(
  root: string,
  filename: string,
  input: {
    relations?: Array<{
      reason: string;
      relation: string;
      target: string;
      targetType: string;
    }>;
    title: string;
    type?: string;
  },
) {
  const filePath = path.join(root, ...filename.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  const relationLines = input.relations
    ? [
        "relations:",
        ...input.relations.flatMap((relation) => [
          `  - relation: "${relation.relation}"`,
          `    target: "${relation.target}"`,
          `    target_type: "${relation.targetType}"`,
          `    reason: "${relation.reason}"`,
        ]),
      ]
    : [];
  await writeFile(
    filePath,
    [
      "---",
      `type: "${input.type ?? "system_topic"}"`,
      'review_status: "approved"',
      `title: "${input.title}"`,
      `description: "About ${input.title}"`,
      'source_file: "manual.pdf"',
      "source_pages:",
      "  - 3",
      ...relationLines,
      "---",
      "",
      `# ${input.title}`,
    ].join("\n"),
    "utf8",
  );
}
