import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getOkfBundleSummary,
  listOkfBundleFiles,
  readOkfBundleFile,
} from "./okf-bundle.ts";

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
        group: "reserved",
        isReserved: true,
        modifiedAt: files[0].modifiedAt,
        reviewStatus: "approved",
        title: "Source Manifest",
        type: "source_manifest",
      },
    ]);
    assert.match(files[0].modifiedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("getOkfBundleSummary groups files and prefers index as default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-summary-"));

  try {
    await writeFile(
      path.join(root, "index.md"),
      [
        "---",
        'type: "index"',
        'review_status: "approved"',
        'title: "Bundle Index"',
        "---",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "topic.md"),
      [
        "---",
        'type: "system_topic"',
        'review_status: "approved"',
        'title: "Quick Action Index"',
        "---",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "future.md"),
      [
        "---",
        'type: "future_type"',
        'review_status: "draft"',
        'title: "Future Type"',
        "---",
      ].join("\n"),
    );

    const summary = await getOkfBundleSummary(root);

    assert.equal(summary.fileCount, 3);
    assert.equal(summary.defaultFile, "index.md");
    assert.equal(summary.groupCounts.reserved, 1);
    assert.equal(summary.groupCounts.system_topic, 1);
    assert.equal(summary.groupCounts.other, 1);
    assert.equal(summary.files.find((file) => file.filename === "index.md")?.isReserved, true);
    assert.equal(summary.files.find((file) => file.filename === "topic.md")?.group, "system_topic");
    assert.equal(summary.files.find((file) => file.filename === "future.md")?.group, "other");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("getOkfBundleSummary falls back to first topic when index is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-summary-topic-"));

  try {
    await writeFile(
      path.join(root, "z-topic.md"),
      [
        "---",
        'type: "system_topic"',
        'review_status: "approved"',
        'title: "Z Topic"',
        "---",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "a-other.md"),
      [
        "---",
        'type: "unknown"',
        'review_status: "approved"',
        'title: "A Other"',
        "---",
      ].join("\n"),
    );

    const summary = await getOkfBundleSummary(root);

    assert.equal(summary.defaultFile, "z-topic.md");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("getOkfBundleSummary returns empty summary for missing knowledge root", async () => {
  const root = path.join(tmpdir(), "av-okf-missing-summary-root");

  const summary = await getOkfBundleSummary(root);

  assert.equal(summary.fileCount, 0);
  assert.equal(summary.defaultFile, undefined);
  assert.deepEqual(summary.groupCounts, {
    fault_route: 0,
    other: 0,
    reserved: 0,
    routing_rule: 0,
    system_topic: 0,
  });
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
