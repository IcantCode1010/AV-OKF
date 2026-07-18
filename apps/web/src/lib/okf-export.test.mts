import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildOkfSystemTopic,
  buildOkfSourceManifest,
  exportTopicToKnowledge,
} from "./okf-export.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";

const execFileAsync = promisify(execFile);

const approvedTopic = {
  id: "topic_32_brakes",
  title: "Main Gear Brake System",
  summary:
    "The main gear brake system provides normal and alternate braking for the main landing gear wheels.",
  pageStart: 41,
  pageEnd: 43,
  reviewStatus: "approved",
  sourcePageNumbers: [41, 42, 43],
};

const exportDocument = {
  title: "737NG AMM 32 Landing Gear",
  subjectFamily: "Boeing 737NG",
  documentType: "AMM",
  classificationCode: "32",
  effectivity: "737-700/800/900",
  sourceAuthority: "Boeing Aircraft Maintenance Manual",
  revision: "2026-06",
};

test("buildOkfSystemTopic emits every required system_topic frontmatter field", async () => {
  const requiredFields = await readRequiredSystemTopicFields();
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });
  const frontmatter = parseFrontmatter(exported.content);

  for (const field of requiredFields) {
    assert.equal(
      Object.hasOwn(frontmatter, field),
      true,
      `missing required frontmatter field: ${field}`,
    );
  }
});

test("buildOkfSystemTopic rejects non-approved topics", () => {
  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: { ...approvedTopic, reviewStatus: "needs_review" },
      }),
    /okf_export_requires_approved_topic/,
  );
});

test("buildOkfSystemTopic keeps AV-OKF extension metadata optional", () => {
  const exported = buildOkfSystemTopic({
    document: {
      ...exportDocument,
      subjectFamily: null,
      effectivity: null,
      sourceAuthority: null,
    },
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });
  assert.doesNotMatch(exported.content, /subject_family|effectivity|source_authority/);
});

test("buildOkfSystemTopic creates deterministic safe classification-code-prefixed filenames", () => {
  const exported = buildOkfSystemTopic({
    document: { ...exportDocument, classificationCode: "32-41" },
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, title: "Main Gear / Brake System?" },
  });

  assert.equal(exported.filename, "32-41-main-gear-brake-system-494f144a6e.md");
  assert.equal(exported.filename.includes(" "), false);
  assert.equal(/[\\/]/.test(exported.filename), false);
});

test("buildOkfSystemTopic rejects titles that produce empty slugs", () => {
  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: { ...approvedTopic, title: "!!!" },
      }),
    /okf_export_invalid_title: title produces empty slug/,
  );
});

test("buildOkfSystemTopic caps long title slugs without trailing hyphen", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: {
      ...approvedTopic,
      id: "topic_long_title",
      title: Array.from({ length: 60 }, (_, index) => `Brake ${index}`).join(" "),
    },
  });
  const withoutExtension = exported.filename.replace(/\.md$/, "");
  const idFragment = "1fd2bae34c";
  const slug = withoutExtension
    .replace(/^32-/, "")
    .replace(new RegExp(`-${idFragment}$`), "");

  assert.equal(exported.filename.length <= 100, true);
  assert.equal(slug.endsWith("-"), false);
});

test("buildOkfSystemTopic avoids collisions for matching titles and classification code", () => {
  const first = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "cmr2m1bze00026uqx8pq55vuv" },
  });
  const second = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "cmr2m1bze00090in0u27bj08j" },
  });

  assert.notEqual(first.filename, second.filename);
});

test("buildOkfSystemTopic produces deterministic filenames for matching topic ids", () => {
  const first = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "cmr2m1bze00026uqx8pq55vuv" },
  });
  const second = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "cmr2m1bze00026uqx8pq55vuv" },
  });

  assert.equal(first.filename, second.filename);
});

test("buildOkfSystemTopic requires a topic id for collision-safe filenames", () => {
  const topicWithoutId = { ...approvedTopic };
  delete (topicWithoutId as Partial<typeof approvedTopic>).id;

  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: topicWithoutId,
      }),
    /okf_export_requires_topic_id/,
  );
});

test("exportTopicToKnowledge updates index idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-"));

  try {
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    const index = await readFile(path.join(root, "index.md"), "utf8");
    const entryCount = index
      .split("\n")
      .filter((line) =>
        line.includes("(32-main-gear-brake-system-494f144a6e.md)"),
      ).length;

    assert.equal(entryCount, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge keeps matching-title topics as separate index entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-collision-"));

  try {
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: { ...approvedTopic, id: "cmr2m1bze00026uqx8pq55vuv" },
    });
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: { ...approvedTopic, id: "cmr2m1bze00090in0u27bj08j" },
    });

    const index = await readFile(path.join(root, "index.md"), "utf8");

    assert.equal(index.includes("(32-main-gear-brake-system-79a711f14d.md)"), true);
    assert.equal(index.includes("(32-main-gear-brake-system-2f8dea0784.md)"), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("buildOkfSystemTopic omits coverage fields when no chunk ids are provided", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });

  assert.equal(exported.content.includes("covered_rag_chunk_ids"), false);
  assert.equal(exported.content.includes("coverage_type"), false);
});

test("buildOkfSystemTopic writes covered_rag_chunk_ids and coverage_type when resolved", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: {
      ...approvedTopic,
      coverageType: "direct_source",
      coveredRagChunkIds: ["chunk_1", "chunk_2"],
    },
  });
  const frontmatter = parseFrontmatter(exported.content);

  assert.deepEqual(frontmatter.covered_rag_chunk_ids, ["chunk_1", "chunk_2"]);
  assert.equal(frontmatter.coverage_type, "direct_source");
});

test("buildOkfSystemTopic frontmatter always marks review_status approved", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });
  const frontmatter = parseFrontmatter(exported.content);

  assert.equal(frontmatter.review_status, "approved");
});

test("buildOkfSourceManifest emits every required source_manifest frontmatter field", async () => {
  const requiredFields = await readRequiredFieldsForType("source_manifest");
  const exported = buildOkfSourceManifest({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.1.0",
  });
  const frontmatter = parseFrontmatter(exported.content);

  assert.equal(exported.filename, "source_manifest.md");
  for (const field of requiredFields) {
    assert.equal(
      Object.hasOwn(frontmatter, field),
      true,
      `missing required frontmatter field: ${field}`,
    );
  }
  for (const field of [
    "subject_family",
    "document_type",
    "effectivity",
    "source_authority",
    "revision",
  ]) {
    assert.equal(
      Object.hasOwn(frontmatter, field),
      false,
      `source_manifest frontmatter should not contain document field: ${field}`,
    );
  }
});

test("exportTopicToKnowledge writes bundle-level source_manifest with idempotent document entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-manifest-"));
  const a320Document = {
    ...exportDocument,
    title: "A320 AMM 27 Flight Controls",
    subjectFamily: "Airbus A320",
    documentType: "AMM",
    classificationCode: "27",
    effectivity: "A320-200",
    sourceAuthority: "Airbus Aircraft Maintenance Manual",
    revision: "2026-05",
  };

  try {
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    await exportTopicToKnowledge({
      document: a320Document,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: {
        ...approvedTopic,
        id: "topic_27_flight_controls",
        pageStart: 12,
        pageEnd: 14,
        sourcePageNumbers: [12, 13, 14],
        title: "Flight Control System",
      },
    });

    const beforeReexport = await readFile(
      path.join(root, "source_manifest.md"),
      "utf8",
    );
    const beforeFrontmatter = parseFrontmatter(beforeReexport);

    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    const manifest = await readFile(path.join(root, "source_manifest.md"), "utf8");
    const frontmatter = parseFrontmatter(manifest);
    const entryCount = manifest
      .split("\n")
      .filter((line) => line.includes("737NG AMM 32 Landing Gear")).length;

    assert.equal(entryCount, 1);
    assert.deepEqual(frontmatter, beforeFrontmatter);
    assert.equal(Object.hasOwn(frontmatter, "subject_family"), false);
    assert.equal(Object.hasOwn(frontmatter, "document_type"), false);
    assert.equal(Object.hasOwn(frontmatter, "effectivity"), false);
    assert.equal(Object.hasOwn(frontmatter, "source_authority"), false);
    assert.equal(Object.hasOwn(frontmatter, "revision"), false);
    assert.match(manifest, /- 737NG AMM 32 Landing Gear/);
    assert.match(manifest, /  - subject_family: Boeing 737NG/);
    assert.match(manifest, /  - source_authority: Boeing Aircraft Maintenance Manual/);
    assert.match(manifest, /- A320 AMM 27 Flight Controls/);
    assert.match(manifest, /  - subject_family: Airbus A320/);
    assert.match(manifest, /  - source_authority: Airbus Aircraft Maintenance Manual/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge creates a raw bundle that passes okflint", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-raw-bundle-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    await assertOkflintPasses(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge appends log entries for export and re-export", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-log-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-03T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    const log = await readFile(path.join(knowledgeRoot, "log.md"), "utf8");
    const entries = log
      .split(/\r?\n/)
      .filter((line) => line.includes("32-main-gear-brake-system-494f144a6e.md"));

    assert.deepEqual(entries, [
      "- 2026-07-02 - export - 32-main-gear-brake-system-494f144a6e.md",
      "- 2026-07-03 - re-export - 32-main-gear-brake-system-494f144a6e.md",
    ]);
    await assertOkflintPasses(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge preserves existing log header and prior entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-existing-log-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    await mkdir(knowledgeRoot, { recursive: true });
    const committedLog = await readFile(
      path.join(process.cwd(), "..", "..", "knowledge", "log.md"),
      "utf8",
    );
    const priorEntry = "- 2026-07-01 - export - existing-topic.md";
    await writeFile(
      path.join(knowledgeRoot, "log.md"),
      `${committedLog.trimEnd()}\n\n${priorEntry}\n`,
      "utf8",
    );

    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    const log = await readFile(path.join(knowledgeRoot, "log.md"), "utf8");

    assert.equal(log.startsWith(committedLog.trimEnd()), true);
    assert.equal(log.includes(priorEntry), true);
    assert.equal(
      log.includes("- 2026-07-02 - export - 32-main-gear-brake-system-494f144a6e.md"),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge exports typed relations that pass both OKF linters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-relation-export-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    const target = await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    const related = await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-03T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: {
        ...approvedTopic,
        id: "topic_32_brake_dispatch",
        title: "Brake Dispatch Route",
        relations: [
          {
            relation: "routes_to",
            target: target.filename,
            targetType: "system_topic",
            reason: "Dispatch questions route to the approved brake system topic.",
          },
        ],
      },
    });

    const markdown = await readFile(path.join(knowledgeRoot, related.filename), "utf8");
    assert.match(markdown, /relations:/);
    assert.match(markdown, /  - relation: "routes_to"/);
    assert.match(markdown, new RegExp(`    target: "${target.filename}"`));
    assert.match(markdown, /    target_type: "system_topic"/);
    await assertOkflintPasses(root);
    await assertRelationLintPasses(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("nested exports emit source-relative relation targets while accepting bundle-relative draft paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-nested-relation-export-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    const directory = "concepts/system-topic";
    const target = await exportTopicToKnowledge({
      directory,
      document: exportDocument,
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    const source = await exportTopicToKnowledge({
      directory,
      document: exportDocument,
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: {
        ...approvedTopic,
        id: "topic_nested_source",
        relations: [{ relation: "supports", target: target.filename, targetType: "system_topic", reason: "Same-folder support." }],
        title: "Nested Source",
      },
    });

    const markdown = await readFile(path.join(knowledgeRoot, source.filename), "utf8");
    assert.match(markdown, new RegExp(`target: "${path.posix.basename(target.filename)}"`));
    await assertRelationLintPasses(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge exports coverage fields that pass okflint", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-coverage-export-"));
  const knowledgeRoot = path.join(root, "knowledge");

  try {
    await copyManifestTo(root);
    const exported = await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot,
      knowledgeVersion: "0.1.0",
      topic: {
        ...approvedTopic,
        coverageType: "direct_source",
        coveredRagChunkIds: ["chunk_1", "chunk_2"],
      },
    });

    const markdown = await readFile(path.join(knowledgeRoot, exported.filename), "utf8");
    assert.match(markdown, /covered_rag_chunk_ids:/);
    assert.match(markdown, /  - chunk_1/);
    assert.match(markdown, /  - chunk_2/);
    assert.match(markdown, /coverage_type: "direct_source"/);
    await assertOkflintPasses(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge fails without writing when relation target is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-relation-missing-"));
  const knowledgeRoot = path.join(root, "knowledge");
  const topicWithMissingRelation = {
    ...approvedTopic,
    id: "topic_missing_relation",
    title: "Missing Relation Target",
    relations: [
      {
        relation: "routes_to",
        target: "missing-target.md",
        targetType: "system_topic",
        reason: "This target was renamed after relation approval.",
      },
    ],
  };
  const failedFilename = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: topicWithMissingRelation,
  }).filename;

  try {
    await copyManifestTo(root);
    await assert.rejects(
      () =>
        exportTopicToKnowledge({
          document: exportDocument,
          exportedAt: new Date("2026-07-02T12:00:00.000Z"),
          knowledgeRoot,
          knowledgeVersion: "0.1.0",
          topic: topicWithMissingRelation,
        }),
      /relation_target_missing/,
    );

    await assert.rejects(
      () => readFile(path.join(knowledgeRoot, failedFilename), "utf8"),
      /ENOENT/,
    );
    await assert.rejects(
      () => readFile(path.join(knowledgeRoot, "log.md"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function readRequiredSystemTopicFields() {
  return readRequiredFieldsForType("system_topic");
}

async function readRequiredFieldsForType(type: string) {
  const manifest = await readFile(
    path.join(process.cwd(), "..", "..", "okf-base.yaml"),
    "utf8",
  );
  const lines = manifest.split(/\r?\n/);
  const systemTopicIndex = lines.findIndex((line) => line.trim() === `${type}:`);
  const requiredIndex = lines.findIndex(
    (line, index) => index > systemTopicIndex && line.trim() === "required:",
  );
  const fields: string[] = [];

  for (const line of lines.slice(requiredIndex + 1)) {
    if (!line.startsWith("      - ")) {
      break;
    }

    fields.push(line.trim().slice(2).trim());
  }

  assert.notEqual(systemTopicIndex, -1);
  assert.notEqual(requiredIndex, -1);
  assert.equal(fields.length > 0, true);

  return fields;
}

function parseFrontmatter(markdown: string) {
  const parsed = parseOkfMarkdown(markdown);
  assert.notDeepEqual(parsed.frontmatter, {}, "expected YAML frontmatter");
  return parsed.frontmatter;
}

async function copyManifestTo(root: string) {
  await copyFile(
    path.join(process.cwd(), "..", "..", "okf-base.yaml"),
    path.join(root, "okf-base.yaml"),
  );
}

async function assertOkflintPasses(root: string) {
  try {
    await execFileAsync("python", ["-m", "okflint", "validate", "--manifest", "okf-base.yaml"], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });
  } catch (error) {
    const details =
      error && typeof error === "object"
        ? `${"stdout" in error ? String(error.stdout) : ""}\n${"stderr" in error ? String(error.stderr) : ""}`
        : String(error);
    assert.fail(`okflint validation failed:\n${details}`);
  }
}

async function assertRelationLintPasses(root: string) {
  const toolPath = path.join(
    process.cwd(),
    "..",
    "..",
    "tools",
    "okf_relation_lint.py",
  );
  try {
    await execFileAsync("python", [toolPath, "--manifest", "okf-base.yaml"], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });
  } catch (error) {
    const details =
      error && typeof error === "object"
        ? `${"stdout" in error ? String(error.stdout) : ""}\n${"stderr" in error ? String(error.stderr) : ""}`
        : String(error);
    assert.fail(`relation lint failed:\n${details}`);
  }
}
