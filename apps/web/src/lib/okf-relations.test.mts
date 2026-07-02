import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RelationValidationError,
  getAllowedRelations,
  validateTopicRelations,
  type TopicRelation,
} from "./okf-relations.ts";

test("getAllowedRelations reads vocabulary from okf-base.yaml", async () => {
  const allowed = await getAllowedRelations();
  const manifestAllowed = await readAllowedRelationsFromManifest();

  assert.deepEqual(allowed, manifestAllowed);

  for (const relation of manifestAllowed) {
    await assert.doesNotReject(() =>
      validateTopicRelations([validRelation({ relation })], fixtureRoot),
    );
  }

  await assert.rejects(
    () =>
      validateTopicRelations(
        [validRelation({ relation: "made_up_relation" })],
        fixtureRoot,
      ),
    (error) =>
      error instanceof RelationValidationError &&
      error.violation.index === 0 &&
      error.violation.code === "relation_type_not_allowed",
  );
});

test("getAllowedRelations can read a Docker-mounted manifest path", async () => {
  const previousManifestPath = process.env.AV_OKF_MANIFEST_PATH;
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-manifest-"));
  const manifestPath = path.join(root, "okf-base.yaml");

  try {
    await writeFile(
      manifestPath,
      ["relations:", "  allowed:", "  - routes_to", "  - supports", ""].join(
        "\n",
      ),
      "utf8",
    );
    process.env.AV_OKF_MANIFEST_PATH = manifestPath;

    assert.deepEqual(await getAllowedRelations(), ["routes_to", "supports"]);
  } finally {
    if (previousManifestPath === undefined) {
      delete process.env.AV_OKF_MANIFEST_PATH;
    } else {
      process.env.AV_OKF_MANIFEST_PATH = previousManifestPath;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("validateTopicRelations reports required validation errors with indexes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-relations-"));

  try {
    await writeTopic(root, "target.md", "system_topic");

    await assertRelationError(
      [validRelation({ relation: "made_up_relation" })],
      root,
      0,
      "relation_type_not_allowed",
    );
    await assertRelationError(
      [validRelation({ target: "target.txt" })],
      root,
      0,
      "relation_target_invalid",
    );
    await assertRelationError(
      [validRelation({ target: "missing.md" })],
      root,
      0,
      "relation_target_missing",
    );
    await assertRelationError(
      [validRelation({ targetType: "dispatch_reference" })],
      root,
      0,
      "relation_target_type_mismatch",
    );
    await assertRelationError(
      [validRelation({ reason: "   " })],
      root,
      0,
      "relation_reason_required",
    );
    await assertRelationError(
      [validRelation(), validRelation({ target: "missing.md" })],
      root,
      1,
      "relation_target_missing",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("validateTopicRelations rejects targets that escape the knowledge root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-relations-paths-"));

  try {
    for (const target of ["../outside.md", "/abs/path.md", "sub/../../escape.md"]) {
      await assertRelationError(
        [validRelation({ target })],
        root,
        0,
        "relation_target_invalid",
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

const fixtureRoot = path.join(tmpdir(), "av-okf-relations-fixture");

test.before(async () => {
  await mkdir(fixtureRoot, { recursive: true });
  await writeTopic(fixtureRoot, "target.md", "system_topic");
});

test.after(async () => {
  await rm(fixtureRoot, { force: true, recursive: true });
});

function validRelation(overrides: Partial<TopicRelation> = {}): TopicRelation {
  return {
    relation: "routes_to",
    target: "target.md",
    targetType: "system_topic",
    reason: "Dispatch questions route to the approved system topic.",
    ...overrides,
  };
}

async function assertRelationError(
  relations: TopicRelation[],
  knowledgeRoot: string,
  index: number,
  code: string,
) {
  await assert.rejects(
    () => validateTopicRelations(relations, knowledgeRoot),
    (error) =>
      error instanceof RelationValidationError &&
      error.violation.index === index &&
      error.violation.code === code,
  );
}

async function writeTopic(root: string, filename: string, type: string) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(
    path.join(root, filename),
    [
      "---",
      `type: "${type}"`,
      'review_status: "approved"',
      'title: "Target"',
      "---",
      "",
      "# Target",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function readAllowedRelationsFromManifest() {
  const manifest = await readFile(
    path.join(process.cwd(), "..", "..", "okf-base.yaml"),
    "utf8",
  );
  const lines = manifest.split(/\r?\n/);
  const allowedIndex = lines.findIndex((line) => line.trim() === "allowed:");
  const values: string[] = [];

  for (const line of lines.slice(allowedIndex + 1)) {
    if (!line.startsWith("  - ")) {
      break;
    }

    values.push(line.trim().slice(2).trim());
  }

  assert.notEqual(allowedIndex, -1);
  assert.equal(values.length > 0, true);
  return values;
}
