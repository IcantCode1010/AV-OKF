import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildOkfV02CompatibilityReport,
  evaluateOkfMarkdownRoundTrip,
} from "./okf-v02-compatibility.ts";

const corpusRoot = fileURLToPath(
  new URL("../../test-fixtures/okf-v02-upstream/", import.meta.url),
);

test("pinned upstream corpus has exact integrity and deterministic round trips", async () => {
  const report = await buildOkfV02CompatibilityReport({ corpusRoot });

  assert.deepEqual(report.totals, {
    bundleFiles: 79,
    conceptFiles: 53,
    indexFiles: 24,
    logFiles: 1,
    markdownFiles: 78,
    resourceFiles: 1,
  });
  assert.equal(report.integrity.valid, true);
  assert.deepEqual(report.integrity.mismatches, []);
  assert.equal(report.summary.portableCompatibleBundles, 4);
  assert.equal(report.summary.roundTripsPassed, 78);
  assert.equal(report.summary.conceptValidationFailures, 0);
  assert.equal(report.summary.agentReadyConcepts, 0);
  assert.equal(report.summary.claimFootnoteReferences, 45);
  assert.equal(report.summary.matchedClaimFootnotes, 33);
  assert.equal(report.summary.claimAttributionWarnings, 11);
  assert.equal(report.summary.warnings, 11);
  assert.equal(report.schemaVersion, 2);
});

test("portable compatibility remains separate from AV runtime readiness", async () => {
  const report = await buildOkfV02CompatibilityReport({ corpusRoot });

  for (const bundle of report.bundles) {
    assert.equal(bundle.portableCompatible, true, bundle.name);
    assert.equal(bundle.runtimeReady, false, bundle.name);
    const expectedCodes = bundle.name === "stackoverflow"
      ? ["okf_v02_claim_source_missing", "okf_v02_version_missing"]
      : ["okf_v02_version_missing"];
    assert.deepEqual(
      [...new Set(bundle.runtimeIssues.map((issue) => issue.code))].sort(),
      expectedCodes,
      bundle.name,
    );
    assert.equal(bundle.agentReadyConcepts, 0, bundle.name);
    assert.ok(Array.isArray(bundle.warnings), bundle.name);
  }
});

test("claim-level footnotes are reported without changing portable conformance", async () => {
  const report = await buildOkfV02CompatibilityReport({ corpusRoot });
  const stackoverflow = report.bundles.find((bundle) => bundle.name === "stackoverflow");
  assert.ok(stackoverflow);
  assert.deepEqual(stackoverflow.claimAttribution, {
    definitions: 11,
    matchedReferences: 0,
    references: 12,
    warnings: 11,
  });
  assert.equal(stackoverflow.portableCompatible, true);
  assert.equal(
    stackoverflow.warnings.every((warning) =>
      warning.code === "okf_v02_claim_source_missing" && warning.target === "1"
    ),
    true,
  );

  for (const bundle of report.bundles.filter((item) => item.name !== "stackoverflow")) {
    assert.equal(bundle.claimAttribution.warnings, 0, bundle.name);
    assert.equal(
      bundle.claimAttribution.references,
      bundle.claimAttribution.matchedReferences,
      bundle.name,
    );
  }
});

test("corpus exercises multiword types and nested producer extensions", async () => {
  const report = await buildOkfV02CompatibilityReport({ corpusRoot });
  const acme = report.bundles.find((bundle) => bundle.name === "acme_retail");
  assert.ok(acme);
  assert.equal(acme.types["Attested Computation"], 2);
  assert.equal(acme.types["BigQuery Table"], 1);
  for (const field of ["attester", "executor", "not", "parameters", "usage_window"]) {
    assert.ok((acme.fields[field] ?? 0) > 0, field);
  }
});

test("canonical round trips normalize line endings without changing content", async () => {
  const source = await readFile(
    fileURLToPath(new URL(
      "../../test-fixtures/okf-v02-upstream/okf/bundles/acme_retail/metrics/gross-margin.md",
      import.meta.url,
    )),
    "utf8",
  );
  assert.deepEqual(evaluateOkfMarkdownRoundTrip(source), { valid: true });
  assert.deepEqual(
    evaluateOkfMarkdownRoundTrip(source.replaceAll("\n", "\r\n")),
    { valid: true },
  );
});
