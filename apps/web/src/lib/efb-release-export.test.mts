import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPackageSignaturePayload,
  exportEfbRelease,
  type EfbReleaseConfig,
} from "./efb-release-export.ts";
import {
  buildStableEfbEntryId,
  resolvePocAircraftApplicability,
  selectNextPocPackageVersion,
} from "./efb-release-automation.ts";

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

test("PoC article identity is stable and does not expose a database topic id", () => {
  const first = buildStableEfbEntryId("topic-canonical-identity");
  assert.equal(first, buildStableEfbEntryId("topic-canonical-identity"));
  assert.match(first, /^article-[a-f0-9]{20}$/);
  assert.equal(first.includes("topic-canonical-identity"), false);
});

test("PoC package versions advance across retained immutable release folders", () => {
  assert.equal(selectNextPocPackageVersion([]), "0.1.0");
  assert.equal(selectNextPocPackageVersion(["0.1.0", "0.1.2", "production"]), "0.1.3");
});

test("manual document applicability overrides article aircraft fields only", () => {
  const manual = resolvePocAircraftApplicability({
    articleAircraftFamilyIds: ["737-ng"],
    articleAircraftTypeIds: ["B738"],
    documentAircraftFamilyIds: ["737-ng"],
    documentAircraftTypeIds: [],
    documentApplicabilityStatus: "manual_override",
  });
  assert.deepEqual(manual, {
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: [],
    manualApplicability: true,
  });

  const classified = resolvePocAircraftApplicability({
    articleAircraftFamilyIds: ["737-ng"],
    articleAircraftTypeIds: ["B738"],
    documentAircraftFamilyIds: ["737-ng"],
    documentAircraftTypeIds: [],
    documentApplicabilityStatus: "accepted",
  });
  assert.deepEqual(classified, {
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: ["B738"],
    manualApplicability: false,
  });
});

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

test("exports an unsigned PoC package in the Project EFB import layout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-poc-"));
  const outputRoot = path.join(root, "release");
  let validatedStagingPath = "";
  const result = await exportEfbRelease({
    config: {
      ...config,
      curator: "av-okf-poc-export",
      license: { attribution: "Prototype content", identifier: "POC-NOT-REVIEWED" },
      mode: "poc",
      packageId: "b738-poc",
      source: "av-okf",
      validationProfile: "poc-structural-only",
      validator: "av-okf-poc-export",
    },
    outputRoot,
    sourceEntries: [{
      markdown: `---
type: system_topic
title: Electrical Power Overview
description: Prototype reference covering the electrical-power system.
status: stable
tags: [electrical, ata-24]
sources:
  - id: source-1
    resource: urn:sha256:${"b".repeat(64)}
    title: AV-OKF source document
source_pages: [1, 2, 3, 4, 5]
aircraft_family_ids: [737-ng]
aircraft_type_ids: []
intended_audiences: [maintenance]
ata: "24"
manual_type: Training Manual
efb_entry_id: b738-ata24-electrical-overview
---

Complete agent-readable article body with enough grounded technical detail to satisfy the structural package gate without claiming technical approval or operational authority.
`,
      relativePath: "topics/electrical-overview.md",
    }],
    validateStagedPackage: async (manifestPath) => {
      validatedStagingPath = manifestPath;
      assert.match(manifestPath, /\.efb-release-staging-/);
      await access(manifestPath);
    },
  });

  assert.equal(path.basename(result.releaseDirectory), "b738-poc@0.1.0");
  assert.notEqual(validatedStagingPath, result.manifestPath);
  assert.equal(result.manifest.signature, undefined);
  assert.equal(result.manifest.entries[0]!.authorityLabel, "Unreviewed prototype knowledge — not approved instructions");
  assert.deepEqual(result.manifest.entries[0]!.applicability, {
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: [],
  });
  assert.equal(result.manifest.entries[0]!.inclusionStatus, "approved-for-inclusion");
  assert.deepEqual(result.manifest.placements.map(({ kind, targetId }) => ({ kind, targetId })), [
    { kind: "ata", targetId: "24" },
  ]);
  assert.match(
    await readFile(path.join(result.releaseDirectory, "display", "b738-ata24-electrical-overview.md"), "utf8"),
    /Unreviewed prototype knowledge — not approved instructions/,
  );
  const agent = JSON.parse(await readFile(
    path.join(result.releaseDirectory, "agent", "b738-ata24-electrical-overview.json"),
    "utf8",
  ));
  assert.equal(agent.authorityLabel, "Unreviewed prototype knowledge — not approved instructions");
  assert.deepEqual(agent.applicability, result.manifest.entries[0]!.applicability);
  assert.deepEqual(agent.placements, [{ kind: "ata", targetId: "24" }]);
  const retrieval = JSON.parse((await readFile(path.join(result.releaseDirectory, "retrieval.jsonl"), "utf8")).trim());
  assert.deepEqual(retrieval.aircraftFamilyIds, ["737-ng"]);
  assert.deepEqual(retrieval.aircraftTypeIds, []);
  assert.deepEqual(retrieval.placements, [{ kind: "ata", targetId: "24" }]);
  await access(path.join(result.releaseDirectory, "checksums.sha256"));
  await access(path.join(result.releaseDirectory, "release.json"));
});

test("keeps 737SAR as provenance while exporting hydraulic placement as ATA 29", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-hydraulic-"));
  const result = await exportEfbRelease({
    config: {
      ...config,
      license: { identifier: "POC-NOT-REVIEWED" },
      mode: "poc",
      packageId: "737-ng-poc",
    },
    outputRoot: path.join(root, "release"),
    sourceEntries: [{
      markdown: `---
type: system_topic
title: Hydraulic Power System
description: Grounded hydraulic power reference.
status: stable
sources: [{ id: source-737sar, resource: "urn:sha256:${"c".repeat(64)}", title: 737SAR }]
source_identifier: 737SAR
source_pages: [2, 3]
aircraft_family_ids: [737-ng]
aircraft_type_ids: []
intended_audiences: [maintenance]
ata: "29"
efb_entry_id: hydraulic-power-system
---

# Hydraulic Power System

This grounded prototype article describes hydraulic pumps, reservoirs, and system pressure with sufficient source-backed detail for structural validation.
`,
      relativePath: "topics/hydraulic-power.md",
    }],
  });

  assert.deepEqual(result.manifest.placements.map(({ kind, targetId }) => ({ kind, targetId })), [
    { kind: "ata", targetId: "29" },
  ]);
  const agent = JSON.parse(await readFile(
    path.join(result.releaseDirectory, "agent", "hydraulic-power-system.json"),
    "utf8",
  ));
  const retrieval = JSON.parse((await readFile(path.join(result.releaseDirectory, "retrieval.jsonl"), "utf8")).trim());
  assert.deepEqual(agent.placements, [{ kind: "ata", targetId: "29" }]);
  assert.deepEqual(retrieval.placements, [{ kind: "ata", targetId: "29" }]);
  assert.equal(JSON.stringify(result.manifest).includes("737SAR"), true);
  assert.equal(result.manifest.placements.some(({ targetId }) => targetId === "737SAR"), false);
});

test("exports every article in a hydraulic corpus to ATA 29 with identical EFB metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-hydraulic-corpus-"));
  const sourceEntries = Array.from({ length: 23 }, (_, index) => {
    const number = index + 1;
    return {
      markdown: `---
type: system_topic
title: Hydraulic Article ${number}
description: Grounded hydraulic article ${number}.
status: stable
sources: [{ id: source-737sar, resource: "urn:sha256:${"e".repeat(64)}", title: "11 Hydraulic Power (737SAR)" }]
source_identifier: 737SAR
source_pages: [${number}]
aircraft_family_ids: [737-ng]
aircraft_type_ids: []
intended_audiences: [maintenance]
ata: "29"
efb_entry_id: hydraulic-article-${number}
---

# Hydraulic Article ${number}

This source-grounded hydraulic reference article contains enough technical context for deterministic Project EFB package validation and parity checks.
`,
      relativePath: `topics/hydraulic-${number}.md`,
    };
  });
  const result = await exportEfbRelease({
    config: { ...config, license: { identifier: "POC-NOT-REVIEWED" }, mode: "poc" },
    outputRoot: path.join(root, "release"),
    sourceEntries,
  });
  assert.equal(result.manifest.entries.length, 23);
  assert.equal(result.manifest.placements.length, 23);
  assert(result.manifest.placements.every(({ kind, targetId }) => kind === "ata" && targetId === "29"));
  assert(result.manifest.entries.every((entry) =>
    JSON.stringify(entry.applicability) === JSON.stringify({ aircraftFamilyIds: ["737-ng"], aircraftTypeIds: [] }) &&
    JSON.stringify(entry.audiences) === JSON.stringify(["maintenance"])
  ));
});

test("rejects non-ATA placement targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-invalid-ata-"));
  await assert.rejects(exportEfbRelease({
    config: { ...config, license: { identifier: "POC-NOT-REVIEWED" }, mode: "poc" },
    outputRoot: path.join(root, "release"),
    sourceEntries: [{
      markdown: `---
type: system_topic
title: Hydraulic Power System
description: Grounded hydraulic power reference.
status: stable
sources: [{ id: source-1, resource: "urn:sha256:${"d".repeat(64)}" }]
source_pages: [2]
aircraft_family_ids: [737-ng]
intended_audiences: [maintenance]
efb_placements: ["ata:737SAR:10"]
efb_entry_id: invalid-hydraulic-placement
---

# Hydraulic Power System

This grounded prototype article is deliberately long enough to reach placement validation and prove source identifiers cannot become ATA targets.
`,
      relativePath: "topics/invalid-hydraulic.md",
    }],
  }), /efb_ata_target_invalid/);
});

test("does not activate a PoC package when staged Project EFB validation fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-efb-poc-invalid-"));
  const outputRoot = path.join(root, "release");
  await assert.rejects(
    exportEfbRelease({
      config: {
        ...config,
        license: { identifier: "POC-NOT-REVIEWED" },
        mode: "poc",
        packageId: "b738-poc",
      },
      outputRoot,
      sourceEntries: [{
        markdown: `---
type: system_topic
title: Electrical Power Overview
description: Prototype reference covering the electrical-power system.
status: stable
sources: [{ id: source-1, resource: "urn:sha256:${"b".repeat(64)}" }]
source_pages: [1]
aircraft_type_ids: [b738]
intended_audiences: [maintenance]
ata: "24"
efb_entry_id: b738-ata24-electrical-overview
---

# Electrical Power Overview

This complete source-grounded body is deliberately valid before the injected external validator rejects it.
`,
        relativePath: "topics/electrical-overview.md",
      }],
      validateStagedPackage: async () => {
        throw new Error("project_efb_validator_rejected");
      },
    }),
    /project_efb_validator_rejected/,
  );
  await assert.rejects(access(path.join(outputRoot, "b738-poc@0.1.0")));
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
