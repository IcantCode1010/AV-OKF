import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPackageSignaturePayload,
  exportEfbRelease,
  type EfbReleaseConfig,
} from "./efb-release-export.ts";

const sourceCommit = "a".repeat(40);
const config: EfbReleaseConfig = {
  schemaVersion: "1.0",
  packageId: "b738-maintenance-reference",
  version: "0.1.0",
  source: "https://example.invalid/av-okf",
  sourceCommit,
  curator: "human:technical-reviewer",
  curatedAt: "2026-09-03T12:00:00Z",
  validatedAt: "2026-09-03T12:30:00Z",
  validator: "av-okf/efb-release-export",
  validationProfile: "efb-open-reference-1",
  license: {
    identifier: "CC-BY-4.0",
    attribution: "Reviewed open reference source",
  },
};

test("exports a deterministic immutable EFB package and keyword index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-release-"));
  const knowledgeRoot = path.join(root, "knowledge");
  const outputRoot = path.join(root, "release");
  await writeArticle(knowledgeRoot, "generator-control.md", {
    id: "b738-ata24-generator-control",
    title: "Generator control overview",
    summary: "A reviewed open-reference overview of generator control.",
    order: 10,
  });
  await writeArticle(knowledgeRoot, "ac-generation.md", {
    id: "b738-ata24-ac-generation",
    title: "AC generation overview",
    summary: "A reviewed open-reference overview of AC generation.",
    order: 20,
    relatedIds: ["b738-ata24-generator-control"],
  });

  const first = await exportEfbRelease({ config, knowledgeRoot, outputRoot });
  const firstManifest = await readFile(first.manifestPath, "utf8");
  const firstIndex = await readFile(path.join(first.releaseDirectory, "retrieval.jsonl"), "utf8");
  const second = await exportEfbRelease({
    config,
    knowledgeRoot,
    outputRoot: path.join(root, "second-release"),
  });
  const secondManifest = await readFile(second.manifestPath, "utf8");

  assert.equal(firstManifest, secondManifest);
  assert.equal(first.manifest.entries.length, 2);
  assert.equal(first.manifest.placements.length, 4);
  assert.deepEqual(first.manifest.entries[0]!.audiences, ["maintenance"]);
  assert.deepEqual(first.manifest.entries[0]!.applicability.aircraftTypeIds, ["b738"]);
  assert.match(firstIndex, /generator control overview/);
  assert.equal(firstIndex.trim().split("\n").length, 2);
  assert.match(
    await readFile(path.join(first.releaseDirectory, "checksums.sha256"), "utf8"),
    /manifest\.json/,
  );
  await assert.rejects(
    exportEfbRelease({ config, knowledgeRoot, outputRoot }),
    /efb_release_version_already_exists/,
  );
});

test("fails closed when an included entry lacks human review", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-unreviewed-"));
  const knowledgeRoot = path.join(root, "knowledge");
  await writeArticle(knowledgeRoot, "unreviewed.md", {
    id: "b738-ata24-unreviewed",
    title: "Unreviewed article",
    summary: "This article must not be published.",
    order: 10,
    verifier: "process:automatic-check",
  });

  await assert.rejects(
    exportEfbRelease({ config, knowledgeRoot, outputRoot: path.join(root, "release") }),
    /efb_entry_requires_human_review/,
  );
});

test("fails closed when a relationship escapes the immutable package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-relation-"));
  const knowledgeRoot = path.join(root, "knowledge");
  await writeArticle(knowledgeRoot, "article.md", {
    id: "b738-ata24-article",
    title: "Article",
    summary: "Reviewed article with an invalid release relationship.",
    order: 10,
    relatedIds: ["missing-entry"],
  });

  await assert.rejects(
    exportEfbRelease({ config, knowledgeRoot, outputRoot: path.join(root, "release") }),
    /efb_related_entry_missing/,
  );
});

test("signs the immutable package checksum with an Ed25519 release key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-signed-"));
  const knowledgeRoot = path.join(root, "knowledge");
  await writeArticle(knowledgeRoot, "signed.md", {
    id: "b738-ata24-signed",
    title: "Signed release article",
    summary: "A reviewed article used to verify detached release signing.",
    order: 10,
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const result = await exportEfbRelease({
    config,
    knowledgeRoot,
    outputRoot: path.join(root, "release"),
    signer: async (payload) => ({
      algorithm: "ed25519",
      keyId: "test-release-key",
      value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
    }),
  });
  const signature = result.manifest.signature;
  assert(signature);
  assert.equal(signature.keyId, "test-release-key");
  const payload = buildPackageSignaturePayload({
    packageVersionId: result.manifest.id,
    checksum: result.manifest.checksum.value,
  });
  assert.equal(
    verify(null, Buffer.from(payload, "utf8"), publicKey, Buffer.from(signature.value, "base64")),
    true,
  );
});

test("fails closed on truncated content and ATA, aircraft, or authority contradictions", async () => {
  const cases = [
    {
      name: "truncated",
      overrides: { body: "# Truncated article\n\nThis source-grounded draft contains enough words to pass the minimum length check but ends before the thought is complete..." },
      error: /efb_entry_truncated/,
    },
    {
      name: "wrong-ata",
      overrides: { ata: "32" },
      error: /efb_entry_ata_contradiction/,
    },
    {
      name: "wrong-aircraft",
      overrides: { effectivity: "A320-251N" },
      error: /efb_entry_aircraft_contradiction/,
    },
    {
      name: "false-authority",
      overrides: { sourceAuthority: "Boeing Aircraft Maintenance Manual" },
      error: /efb_entry_source_authority_contradiction/,
    },
  ] as const;

  for (const item of cases) {
    const root = await mkdtemp(path.join(tmpdir(), `av-okf-efb-${item.name}-`));
    const knowledgeRoot = path.join(root, "knowledge");
    await writeArticle(knowledgeRoot, `${item.name}.md`, {
      id: `b738-ata24-${item.name}`,
      title: `${item.name} article`,
      summary: "A candidate that must fail the EFB content-quality release gate.",
      order: 10,
      ...item.overrides,
    });
    await assert.rejects(
      exportEfbRelease({ config, knowledgeRoot, outputRoot: path.join(root, "release") }),
      item.error,
      item.name,
    );
  }
});

async function writeArticle(
  knowledgeRoot: string,
  filename: string,
  input: {
    id: string;
    title: string;
    summary: string;
    order: number;
    relatedIds?: string[];
    verifier?: string;
    ata?: string;
    body?: string;
    effectivity?: string;
    sourceAuthority?: string;
  },
) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(knowledgeRoot, { recursive: true });
  const related = input.relatedIds?.length
    ? `efb_related_entry_ids:\n${input.relatedIds.map((id) => `  - ${id}`).join("\n")}\n`
    : "";
  await writeFile(path.join(knowledgeRoot, filename), `---
type: system_topic
title: ${input.title}
description: ${input.summary}
status: stable
tags:
  - electrical
  - ata-24
verified:
  - by: ${input.verifier ?? "human:technical-reviewer"}
    at: 2026-09-03T12:00:00Z
sources:
  - id: open-source-1
    resource: https://example.invalid/source
    title: Reviewed open reference source
source_pages:
  - 1
aircraft_family: Boeing 737NG
effectivity: ${input.effectivity ?? "737-700/800/900"}
ata: "${input.ata ?? "24"}"
source_authority: ${input.sourceAuthority ?? "Reviewed open training reference"}
efb_entry_id: ${input.id}
efb_audiences:
  - maintenance
efb_aircraft_type_ids:
  - b738
efb_placements:
  - ata:24:${input.order}
  - quick-access:maintenance:${input.order}
efb_authority_label: Open reference — not approved maintenance instructions
efb_license_identifier: CC-BY-4.0
efb_license_reviewed_by: human:license-reviewer
efb_license_reviewed_at: 2026-09-03T11:00:00Z
efb_content_purpose: maintenance-reference
efb_inclusion_status: approved-for-inclusion
efb_source_classification: training-reference
${related}---

${input.body ?? `# ${input.title}\n\nThis is display-ready and agent-readable reviewed reference content with sufficient detail for the release quality gate.`}
`, "utf8");
}
