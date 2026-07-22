import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { KnowledgeBundleRecord } from "./knowledge-bundles.ts";
import {
  loadApprovedOkfTopicView,
  resolveApprovedOkfTopicLink,
} from "./okf-topic-view.ts";

const context: AuthWorkspaceContext = {
  role: "member",
  userId: "user-1",
  workspaceId: "workspace-1",
};

const bundle = {
  activeProfileVersion: 1,
  createdAt: "2026-07-21T00:00:00.000Z",
  description: "Test bundle",
  documentCount: 1,
  id: "bundle-1",
  name: "Test Knowledge",
  profile: {} as KnowledgeBundleRecord["profile"],
  slug: "test-knowledge",
  status: "active",
  updatedAt: "2026-07-21T00:00:00.000Z",
  workspaceId: context.workspaceId,
} satisfies KnowledgeBundleRecord;

test("approved active topic view returns article and provenance fields", async () => {
  const fixture = await createBundleFixture();
  try {
    const result = await loadApprovedOkfTopicView({
      bundleId: bundle.id,
      context,
      filePath: fixture.filePath,
      knowledgeRoot: fixture.root,
    }, dependencies(new Map([[fixture.filePath, { status: "active" }]])));

    assert.equal(result?.title, "Vehicle Pre-Start Inspection");
    assert.equal(result?.approvalProvenance, "automated");
    assert.deepEqual(result?.sourcePages, [12, 13]);
    assert.match(result?.body ?? "", /Inspect the vehicle before operation/);
    assert.equal(result?.descriptionRepeatedExactly, false);
    assert.deepEqual(result?.approvedFilePaths, [fixture.filePath]);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("cross-workspace bundle denial happens before bundle files are listed", async () => {
  let listed = false;
  const result = await loadApprovedOkfTopicView({
    bundleId: "foreign-bundle",
    context,
    filePath: "concepts/system/foreign.md",
  }, {
    async getBundle(input) {
      assert.equal(input.context.workspaceId, context.workspaceId);
      return null;
    },
    async listFiles() {
      listed = true;
      return [];
    },
  });

  assert.equal(result, null);
  assert.equal(listed, false);
});

test("unsafe and encoded traversal paths never resolve to a topic", async () => {
  const fixture = await createBundleFixture();
  try {
    for (const filePath of [
      "../outside.md",
      "concepts/../../outside.md",
      "..\\outside.md",
      "/absolute/outside.md",
      "%2e%2e%2foutside.md",
      "%252e%252e%252foutside.md",
    ]) {
      const result = await loadApprovedOkfTopicView({
        bundleId: bundle.id,
        context,
        filePath,
        knowledgeRoot: fixture.root,
      }, dependencies(new Map([[fixture.filePath, { status: "active" }]])));
      assert.equal(result, null, filePath);
    }
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("non-active lifecycle states and unapproved frontmatter fail closed", async () => {
  const fixture = await createBundleFixture();
  try {
    for (const status of ["archived", "retracted", "deleted"] as const) {
      const result = await loadApprovedOkfTopicView({
        bundleId: bundle.id,
        context,
        filePath: fixture.filePath,
        knowledgeRoot: fixture.root,
      }, dependencies(new Map([[fixture.filePath, { status }]])));
      assert.equal(result, null, status);
    }

    await writeFile(path.join(fixture.root, fixture.filePath), topicMarkdown("needs_review"), "utf8");
    const unapproved = await loadApprovedOkfTopicView({
      bundleId: bundle.id,
      context,
      filePath: fixture.filePath,
      knowledgeRoot: fixture.root,
    }, dependencies(new Map([[fixture.filePath, { status: "active" }]])));
    assert.equal(unapproved, null);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("symlink escapes are not exposed as listed topic files", async (t) => {
  const fixture = await createBundleFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "okf-topic-outside-"));
  try {
    const outsideFile = path.join(outside, "outside.md");
    const linkedFile = path.join(fixture.root, "concepts", "system", "linked.md");
    await writeFile(outsideFile, topicMarkdown("approved"), "utf8");
    try {
      await symlink(outsideFile, linkedFile, "file");
    } catch {
      t.skip("symlink creation is unavailable in this environment");
      return;
    }
    const result = await loadApprovedOkfTopicView({
      bundleId: bundle.id,
      context,
      filePath: "concepts/system/linked.md",
      knowledgeRoot: fixture.root,
    }, dependencies(new Map([["concepts/system/linked.md", { status: "active" }]])));
    assert.equal(result, null);
  } finally {
    await Promise.all([
      rm(fixture.root, { force: true, recursive: true }),
      rm(outside, { force: true, recursive: true }),
    ]);
  }
});

test("topic Markdown links permit only known approved bundle-relative files", () => {
  const approvedFilePaths = [
    "concepts/system/brakes.md",
    "concepts/system/inspection.md",
  ];
  assert.deepEqual(resolveApprovedOkfTopicLink({
    approvedFilePaths,
    href: "./inspection.md",
    sourceFile: "concepts/system/brakes.md",
  }), { filePath: "concepts/system/inspection.md", kind: "internal" });
  assert.deepEqual(resolveApprovedOkfTopicLink({
    approvedFilePaths,
    href: "https://example.com/reference",
    sourceFile: "concepts/system/brakes.md",
  }), { kind: "external" });
  for (const href of ["../../../outside.md", "/absolute.md", "\\outside.md", "missing.md"]) {
    assert.deepEqual(resolveApprovedOkfTopicLink({
      approvedFilePaths,
      href,
      sourceFile: "concepts/system/brakes.md",
    }), { kind: "broken" }, href);
  }
});

function dependencies(lifecycles: Map<string, { status: "active" | "archived" | "deleted" | "retracted" }>) {
  return {
    async getBundle() {
      return bundle;
    },
    async getLifecycles() {
      return lifecycles;
    },
  };
}

async function createBundleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "okf-topic-view-"));
  const filePath = "concepts/system/inspection.md";
  await mkdir(path.dirname(path.join(root, filePath)), { recursive: true });
  await writeFile(path.join(root, filePath), topicMarkdown("approved"), "utf8");
  return { filePath, root };
}

function topicMarkdown(reviewStatus: string) {
  return `---
type: procedure
title: Vehicle Pre-Start Inspection
description: Checks required before operating the vehicle.
updated: 2026-07-21
review_status: ${reviewStatus}
source_file: vehicle-manual.pdf
source_pages:
  - 12
  - 13
approved_by: automation:user-1
approved_at: 2026-07-21
---

Inspect the vehicle before operation.
`;
}
