import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { listOkfBundleFiles, readOkfBundleFile } from "./okf-bundle.ts";

test("listOkfBundleFiles lists markdown files with frontmatter labels", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-preview-"));

  try {
    await writeFile(
      path.join(root, "source_manifest.md"),
      [
        "---",
        'type: "source_manifest"',
        'review_status: "approved"',
        'title: "Source Manifest"',
        "---",
        "",
        "# Source Manifest",
      ].join("\n"),
    );
    await writeFile(path.join(root, "ignore.txt"), "not markdown");

    const files = await listOkfBundleFiles(root);

    assert.deepEqual(files, [
      {
        filename: "source_manifest.md",
        reviewStatus: "approved",
        title: "Source Manifest",
        type: "source_manifest",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("readOkfBundleFile reads only markdown files inside the bundle root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-preview-read-"));

  try {
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "topic.md"), "# Topic\n");
    await writeFile(path.join(root, "notes.txt"), "nope");

    const file = await readOkfBundleFile(root, "nested/topic.md");
    assert.equal(file.filename, "nested/topic.md");
    assert.equal(file.content, "# Topic\n");

    await assert.rejects(
      () => readOkfBundleFile(root, "../escape.md"),
      /okf_preview_path_escapes_root/,
    );
    await assert.rejects(
      () => readOkfBundleFile(root, "notes.txt"),
      /okf_preview_only_markdown/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
