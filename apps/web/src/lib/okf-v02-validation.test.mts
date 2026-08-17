import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertOkfV02Bundle } from "./okf-version.ts";
import {
  validateOkfV02BundleRoot,
  validatePortableOkfV02BundleRoot,
} from "./okf-v02-validation.ts";

test("v0.2 validator accepts a trusted concept with a portable source reference", async () => {
  const root = await createFixture();
  try {
    assert.deepEqual(await validateOkfV02BundleRoot(root), []);
    await assertOkfV02Bundle({ knowledgeRoot: root, okfVersion: "0.2" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("v0.2 runtime guard requires both database and root-index declarations", async () => {
  const root = await createFixture();
  try {
    await assert.rejects(
      assertOkfV02Bundle({ knowledgeRoot: root, okfVersion: "0.1" }),
      /okf_bundle_requires_v0_2_migration/,
    );
    await writeFile(path.join(root, "index.md"), "---\ntype: index\nokf_version: '0.1'\n---\n");
    await assert.rejects(
      assertOkfV02Bundle({ knowledgeRoot: root, okfVersion: "0.2" }),
      /okf_bundle_requires_v0_2_migration/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("v0.2 validator reports missing trusted source references", async () => {
  const root = await createFixture();
  try {
    await rm(path.join(root, "references", "sources", "manual.md"));
    assert.equal(
      (await validateOkfV02BundleRoot(root)).some(
        (issue) => issue.code === "okf_v02_source_reference_missing",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("v0.2 validator rejects broken and escaping typed relation targets", async () => {
  const root = await createFixture();
  try {
    const conceptPath = path.join(root, "concept.md");
    const original = await readFile(conceptPath, "utf8");
    await writeFile(
      conceptPath,
      original.replace(
        "source_pages: [1]",
        `source_pages: [1]\nrelations:\n  - relation: references\n    target: ../outside.md\n    target_type: reference\n    reason: Unsafe target`,
      ),
    );
    assert.equal(
      (await validateOkfV02BundleRoot(root)).some(
        (issue) => issue.code === "okf_v02_relation_target_unsafe",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("portable validation accepts multiword types without a root index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-v02-portable-"));
  try {
    await mkdir(path.join(root, "tables"), { recursive: true });
    await writeFile(path.join(root, "tables", "events.md"), `---
type: BigQuery Table
x_producer:
  nested: true
---

Events.
`);
    assert.deepEqual(await validatePortableOkfV02BundleRoot(root), []);
    assert.equal(
      (await validateOkfV02BundleRoot(root)).some(
        (issue) => issue.code === "okf_v02_index_missing",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("nested indexes are reserved files rather than concepts", async () => {
  const root = await createFixture();
  try {
    await mkdir(path.join(root, "concepts"), { recursive: true });
    await writeFile(path.join(root, "concepts", "index.md"), "# Concepts\n");
    assert.deepEqual(await validatePortableOkfV02BundleRoot(root), []);
    assert.deepEqual(await validateOkfV02BundleRoot(root), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("root version is optional for portable bundles and mandatory at runtime", async () => {
  const root = await createFixture();
  try {
    await writeFile(path.join(root, "index.md"), "# Portable bundle\n");
    assert.deepEqual(await validatePortableOkfV02BundleRoot(root), []);
    assert.equal(
      (await validateOkfV02BundleRoot(root)).some(
        (issue) => issue.code === "okf_v02_version_missing",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("portable validation rejects malformed log date headings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-v02-log-"));
  try {
    await writeFile(path.join(root, "log.md"), "# Log\n\n## August 16\n- Updated\n");
    assert.equal(
      (await validatePortableOkfV02BundleRoot(root)).some(
        (issue) => issue.code === "okf_v02_log_date_invalid",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-v02-validator-"));
  await mkdir(path.join(root, "references", "sources"), { recursive: true });
  await writeFile(path.join(root, "index.md"), `---
okf_version: "0.2"
---

# Test bundle
`);
  await writeFile(path.join(root, "concept.md"), `---
type: procedure
title: Inspection
status: stable
verified:
  - by: human:reviewer
    at: 2026-08-06T12:00:00.000Z
sources:
  - resource: /references/sources/manual.md
source_pages: [1]
---

Inspection body.
`);
  await writeFile(path.join(root, "references", "sources", "manual.md"), `---
type: reference
title: Manual
resource: urn:sha256:${"a".repeat(64)}
status: stable
generated:
  by: process:test
  at: 2026-08-06T12:00:00.000Z
av_okf_role: source_document
---

Source.
`);
  await writeFile(path.join(root, "log.md"), "# Change Log\n");
  return root;
}
