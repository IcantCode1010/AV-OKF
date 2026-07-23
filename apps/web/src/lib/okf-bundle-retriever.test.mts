import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deriveMetadataClarification,
  retrieveOkfBundleEvidence,
  retrieveOkfBundleEvidenceWithDiagnostics,
  type OkfNearMissCandidate,
} from "./okf-bundle-retriever.ts";

test("approved system_topic returns normalized OKF evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-"));

  try {
    await writeTopic(root, "32-brakes.md", {
      body: "The brake system provides normal and alternate braking.",
      description:
        "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "main gear brake",
      workspaceId: "wrk_1",
    });

    assert.equal(result?.sourceType, "okf_bundle");
    assert.equal(result?.filePath, "32-brakes.md");
    assert.equal(result?.title, "Main Gear Brake System");
    assert.equal(result?.reviewStatus, "approved");
    assert.equal(result?.sourceFile, "737NG AMM 32 Landing Gear");
    assert.deepEqual(result?.sourcePages, [41, 42, 43]);
    assert.equal(result?.pageStart, 41);
    assert.equal(result?.pageEnd, 43);
    assert.match(result?.excerpt ?? "", /normal and alternate braking/i);
    assert.deepEqual(result?.matchedTerms, ["main", "gear", "brake"]);
    assert.equal(result?.matchStrength, "strong");
    assert.match(result?.matchReason ?? "", /title phrase/i);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("approved evidence removes repeated article framing and exact description duplication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-clean-reader-"));

  try {
    const description = "Cargo door procedures cover safe operation and inspection.";
    await writeTopic(root, "cargo-doors.md", {
      body: [
        "# Cargo Door Procedures",
        "",
        description,
        "",
        "## Inspection",
        "",
        "Inspect the hinges before operation.",
        "",
        "## Source",
        "",
        "Manual.pdf, page 12",
      ].join("\n"),
      description,
      title: "Cargo Door Procedures",
    });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "cargo door procedures",
      workspaceId: "wrk_1",
    });

    assert.equal(result?.body.startsWith("# Cargo Door Procedures"), false);
    assert.doesNotMatch(result?.body ?? "", /## Source/);
    assert.equal((result?.excerpt.match(/Cargo door procedures cover/gi) ?? []).length, 1);
    assert.match(result?.excerpt ?? "", /Inspect the hinges before operation/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever exposes automated and human approval provenance from live frontmatter", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-provenance-"));
  try {
    await writeTopic(root, "automated.md", {
      extraFrontmatter: ['approved_by: "automation:user-1"'],
      title: "Automated Brake Procedure",
    });
    await writeTopic(root, "human.md", {
      extraFrontmatter: ['approved_by: "user-2"'],
      title: "Human Brake Procedure",
    });
    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake procedure",
      workspaceId: "wrk_1",
    });
    assert.deepEqual(
      Object.fromEntries(results.map((result) => [result.filePath, result.approvalProvenance])),
      { "automated.md": "automated", "human.md": "human" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever ignores unapproved, missing-review, and reserved files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-ignore-"));

  try {
    await writeTopic(root, "approved.md", { title: "Approved Brake Topic" });
    await writeTopic(root, "needs-review.md", {
      reviewStatus: "needs_review",
      title: "Needs Review Brake Topic",
    });
    await writeTopic(root, "draft.md", {
      reviewStatus: "draft",
      title: "Draft Brake Topic",
    });
    await writeFile(path.join(root, "missing-review.md"), [
      "---",
      'type: "system_topic"',
      'title: "Missing Review Brake Topic"',
      "---",
      "",
      "Brake text",
    ].join("\n"));
    await writeFile(path.join(root, "index.md"), "Brake index text");

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      results.map((result) => result.filePath),
      ["approved.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever parses relations and coverage fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-fields-"));

  try {
    await writeTopic(root, "brakes.md", {
      extraFrontmatter: [
        "covered_rag_chunk_ids:",
        "  - chunk_1",
        "  - chunk_2",
        'coverage_type: "direct_source"',
        "relations:",
        '  - relation: "routes_to"',
        '    target: "brakes.md"',
        '    target_type: "system_topic"',
        '    reason: "Route dispatch questions here."',
      ],
      title: "Brake Dispatch Route",
    });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake dispatch",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result?.coveredRagChunkIds, ["chunk_1", "chunk_2"]);
    assert.equal(result?.coverageType, "direct_source");
    assert.deepEqual(result?.relations, [
      {
        relation: "routes_to",
        target: "brakes.md",
        targetType: "system_topic",
        reason: "Route dispatch questions here.",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("missing bundle root returns no evidence", async () => {
  const root = path.join(tmpdir(), `av-okf-missing-${Date.now()}`);

  const results = await retrieveOkfBundleEvidence({
    knowledgeRoot: root,
    query: "brake",
    workspaceId: "wrk_1",
  });

  assert.deepEqual(results, []);
});

test("ranking is deterministic", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-ranking-"));

  try {
    await writeTopic(root, "b.md", { title: "Brake System B" });
    await writeTopic(root, "a.md", { title: "Brake System A" });

    const first = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });
    const second = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      first.map((result) => result.filePath),
      second.map((result) => result.filePath),
    );
    assert.deepEqual(
      first.map((result) => result.filePath),
      ["a.md", "b.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever reads bundle live and stops surfacing unapproved changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-live-"));
  const target = path.join(root, "brakes.md");

  try {
    await writeTopic(root, "brakes.md", { title: "Brake System" });

    assert.equal(
      (
        await retrieveOkfBundleEvidence({
          knowledgeRoot: root,
          query: "brake",
          workspaceId: "wrk_1",
        })
      ).length,
      1,
    );

    await writeTopic(root, "brakes.md", {
      reviewStatus: "needs_review",
      title: "Brake System",
    });

    assert.equal(
      (
        await retrieveOkfBundleEvidence({
          knowledgeRoot: root,
          query: "brake",
          workspaceId: "wrk_1",
        })
      ).length,
      0,
    );
    assert.equal(path.resolve(target).startsWith(path.resolve(root)), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever accepts approved agent-ready content without optional description", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-missing-field-"));

  try {
    await writeFile(path.join(root, "no-description.md"), [
      "---",
      'type: "system_topic"',
      'review_status: "approved"',
      'title: "Brake System Missing Description"',
      'source_file: "737NG AMM 32 Landing Gear"',
      "source_pages:",
      "  - 41",
      "---",
      "",
      "Brake system body text.",
    ].join("\n"));

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.description, "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever returns no evidence for an empty or whitespace-only query", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-empty-query-"));

  try {
    await writeTopic(root, "brakes.md", {});

    const emptyResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "",
      workspaceId: "wrk_1",
    });
    const whitespaceResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "   ",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(emptyResults, []);
    assert.deepEqual(whitespaceResults, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("topK truncates results and defaults to 4", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-topk-"));

  try {
    for (const letter of ["a", "b", "c", "d", "e"]) {
      await writeTopic(root, `${letter}.md`, {
        title: `Brake System ${letter.toUpperCase()}`,
      });
    }

    const defaultResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });
    const limitedResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      topK: 2,
      workspaceId: "wrk_1",
    });

    assert.equal(defaultResults.length, 4);
    assert.equal(limitedResults.length, 2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("retriever traverses nested subdirectories under the bundle root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-nested-"));

  try {
    await writeTopic(root, "systems/hydraulics/32-brakes.md", {});

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      results.map((result) => result.filePath),
      ["systems/hydraulics/32-brakes.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("excerpt truncates at the max length with a trailing ellipsis", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-excerpt-"));

  try {
    const longBody = Array.from({ length: 400 }, () => "brake system detail").join(
      " ",
    );
    await writeTopic(root, "brakes.md", { body: longBody });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.equal(result?.excerpt.endsWith("..."), true);
    assert.equal((result?.excerpt.length ?? 0) <= 1500, true);
    assert.equal((result?.excerpt.length ?? 0) >= 1490, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an exact multi-word title match outranks scattered single-term body matches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-scoring-"));

  try {
    await writeTopic(root, "scattered.md", {
      body: "This page discusses gear inspection procedures. Later sections cover main assembly torque. Separately, brake wear indicators are described elsewhere.",
      description: "General airframe inspection notes, unrelated to specific systems.",
      title: "Unrelated Maintenance Notes",
    });
    await writeTopic(root, "exact.md", {
      title: "Main Gear Brake System",
    });

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "main gear brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      results.map((result) => result.filePath),
      ["exact.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("identical scores and titles tie-break by file path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-tiebreak-"));

  try {
    await writeTopic(root, "z-file.md", { title: "Brake System" });
    await writeTopic(root, "a-file.md", { title: "Brake System" });

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      results.map((result) => result.filePath),
      ["a-file.md", "z-file.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("unrelated sparse-bundle questions do not match an approved topic through common terms", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-sparse-false-positive-"));

  try {
    await writeTopic(root, "32-brakes.md", {
      body: "The brake system provides normal and alternate braking.",
      description:
        "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const galleyResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "galley water heater leak troubleshooting",
      workspaceId: "wrk_1",
    });
    const pressurizationResults = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "cabin pressurization system checks",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(galleyResults, []);
    assert.deepEqual(pressurizationResults, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("generic-only queries do not qualify an approved OKF topic", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-generic-only-"));

  try {
    await writeTopic(root, "32-brakes.md", {
      body: "The brake system provides normal and alternate braking.",
      description:
        "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "system procedure check",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(results, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a single meaningful title term can qualify a short OKF query", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-single-term-"));

  try {
    await writeTopic(root, "32-brakes.md", {
      body: "The brake system provides normal and alternate braking.",
      description:
        "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.equal(result?.filePath, "32-brakes.md");
    assert.deepEqual(result?.matchedTerms, ["brake"]);
    assert.equal(result?.matchStrength, "medium");
    assert.match(result?.matchReason ?? "", /title/i);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("body-only matches do not qualify approved OKF evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-body-only-"));

  try {
    await writeTopic(root, "32-brakes.md", {
      body: "Hydraulic fuse inspection appears only in the body text.",
      description: "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "hydraulic fuse",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(results, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("lifecycle lookup excludes retracted and archived approved topics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-lifecycle-"));

  try {
    await writeTopic(root, "active.md", { title: "Active Brake System" });
    await writeTopic(root, "retracted.md", { title: "Retracted Brake System" });
    await writeTopic(root, "archived.md", { title: "Archived Brake System" });

    const results = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      lifecycleLookup: async ({ filePath }) => {
        if (filePath === "retracted.md") {
          return { status: "retracted", reason: "Incorrect source mapping" };
        }
        if (filePath === "archived.md") {
          return { status: "archived", reason: "Historical revision" };
        }
        return { status: "active" };
      },
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(
      results.map((result) => result.filePath),
      ["active.md"],
    );
    assert.equal(results[0]?.lifecycleStatus, "active");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("broken relation targets add lifecycle warnings without dropping source evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-relation-warning-"));

  try {
    await writeTopic(root, "brakes.md", {
      extraFrontmatter: [
        "relations:",
        '  - relation: "references"',
        '    target: "missing.md"',
        '    target_type: "system_topic"',
        '    reason: "Background context."',
      ],
      title: "Brake System",
    });

    const [result] = await retrieveOkfBundleEvidence({
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.equal(result?.filePath, "brakes.md");
    assert.deepEqual(result?.lifecycleWarnings, [
      "relation_target_missing:0:missing.md",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("semantic lookup recovers an approved concept when lexical terms do not overlap", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-semantic-"));
  try {
    await writeTopic(root, "brakes.md", { title: "Main Gear Brake System" });
    let searched = false;
    const [result] = await retrieveOkfBundleEvidence({
      knowledgeBundleId: "bundle_1",
      knowledgeRoot: root,
      query: "wheel deceleration equipment",
      semantic: {
        getMetadata: async () => {
          const [{ contentHash, filePath }] = await import("./okf-bundle-retriever.ts").then(
            ({ listApprovedOkfBundleEvidence }) =>
              listApprovedOkfBundleEvidence({ knowledgeBundleId: "bundle_1", knowledgeRoot: root, workspaceId: "wrk_1" }),
          );
          return [{ contentHash, filePath }];
        },
        search: async ({ candidates }) => {
          searched = true;
          return [{ filePath: candidates[0]!.filePath, score: 0.81 }];
        },
      },
      workspaceId: "wrk_1",
    });
    assert.equal(searched, true);
    assert.equal(result?.filePath, "brakes.md");
    assert.equal(result?.okfMatchMode, "vector");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("semantic lookup excludes stale hashes and queues their replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-stale-"));
  try {
    await writeTopic(root, "brakes.md", { title: "Main Gear Brake System" });
    const queued: Array<{ contentHash: string; filePath: string }> = [];
    const results = await retrieveOkfBundleEvidence({
      knowledgeBundleId: "bundle_1",
      knowledgeRoot: root,
      query: "wheel deceleration equipment",
      semantic: {
        enqueueMissing: async (candidates) => queued.push(...candidates),
        getMetadata: async () => [{ contentHash: "stale", filePath: "brakes.md" }],
        search: async () => assert.fail("stale embeddings must not be searched"),
      },
      workspaceId: "wrk_1",
    });
    assert.deepEqual(results, []);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.filePath, "brakes.md");
    assert.notEqual(queued[0]?.contentHash, "stale");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("approved evidence exposes only profile-allowlisted user-answerable metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-answerable-"));
  try {
    await writeTopic(root, "brakes.md", {
      extraFrontmatter: [
        'subject_family: "Forklift"',
        'document_type: "Operations Manual"',
        'source_authority: "Manufacturer"',
        'revision: "12"',
      ],
    });
    const [result] = await retrieveOkfBundleEvidence({
      clarificationFields: [
        "subject_family",
        "document_type",
        "source_authority",
        "revision",
      ],
      knowledgeRoot: root,
      query: "brake",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result?.answerableMetadata, {
      document_type: ["Operations Manual"],
      subject_family: ["Forklift"],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("weak approved candidates derive one metadata clarification without becoming evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-retriever-near-miss-"));
  try {
    for (const [filename, family] of [["forklift.md", "Forklift"], ["automobile.md", "Automobile"]]) {
      await writeTopic(root, filename, {
        body: "Hydraulic fuse inspection appears only in the body text.",
        description: "General maintenance information.",
        extraFrontmatter: [`subject_family: "${family}"`],
        title: `${family} Maintenance`,
      });
    }
    const result = await retrieveOkfBundleEvidenceWithDiagnostics({
      clarificationFields: ["subject_family", "source_authority"],
      knowledgeRoot: root,
      query: "hydraulic fuse",
      semantic: {
        getMetadata: async () => [],
        search: async () => assert.fail("missing vectors must not be searched"),
      },
      workspaceId: "wrk_1",
    });

    assert.deepEqual(result.qualifiedEvidence, []);
    assert.equal(result.nearMissCandidates.length, 2);
    assert.equal("body" in result.nearMissCandidates[0]!, false);
    assert.deepEqual(result.metadataClarification?.fields, [
      {
        field: "subject_family",
        label: "Subject or family",
        options: ["Automobile", "Forklift"],
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("metadata clarification follows profile order and asks at most two fields", () => {
  const candidates: OkfNearMissCandidate[] = [
    makeNearMiss("a.md", { document_type: ["Manual"], subject_family: ["Forklift"], tags: ["Safety"] }),
    makeNearMiss("b.md", { document_type: ["Policy"], subject_family: ["Automobile"], tags: ["Compliance"] }),
  ];

  const clarification = deriveMetadataClarification(candidates, [
    "tags",
    "document_type",
    "subject_family",
  ]);
  assert.deepEqual(clarification?.fields.map((field) => field.field), [
    "tags",
    "document_type",
  ]);
});

test("metadata clarification is absent when no allowlisted axis partitions candidates", () => {
  const candidates = [
    makeNearMiss("a.md", { subject_family: ["Forklift"] }),
    makeNearMiss("b.md", { subject_family: ["Forklift"] }),
  ];
  assert.equal(
    deriveMetadataClarification(candidates, ["subject_family"]),
    undefined,
  );
});

function makeNearMiss(
  filePath: string,
  answerableMetadata: Record<string, string[]>,
): OkfNearMissCandidate {
  return {
    answerableMetadata,
    filePath,
    lexicalScore: 2,
    matchReason: "Weak lexical match",
    title: filePath,
  };
}

async function writeTopic(
  root: string,
  filename: string,
  options: {
    body?: string;
    description?: string;
    extraFrontmatter?: string[];
    reviewStatus?: string;
    title?: string;
  } = {},
) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(
    path.join(root, filename),
    [
      "---",
      'type: "system_topic"',
      `review_status: "${options.reviewStatus ?? "approved"}"`,
      `title: "${options.title ?? "Main Gear Brake System"}"`,
      `description: "${
        options.description ??
        "The main gear brake system provides normal and alternate braking."
      }"`,
      'source_file: "737NG AMM 32 Landing Gear"',
      "source_pages:",
      "  - 41",
      "  - 42",
      "  - 43",
      ...(options.extraFrontmatter ?? []),
      "---",
      "",
      "# Topic",
      "",
      options.body ?? "Brake system body text.",
    ].join("\n"),
    "utf8",
  );
}
