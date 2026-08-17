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
  assert.ok(Number.isInteger(report.summary.warnings));
});

test("portable compatibility remains separate from AV runtime readiness", async () => {
  const report = await buildOkfV02CompatibilityReport({ corpusRoot });

  for (const bundle of report.bundles) {
    assert.equal(bundle.portableCompatible, true, bundle.name);
    assert.equal(bundle.runtimeReady, false, bundle.name);
    assert.deepEqual(
      [...new Set(bundle.runtimeIssues.map((issue) => issue.code))],
      ["okf_v02_version_missing"],
      bundle.name,
    );
    assert.equal(bundle.agentReadyConcepts, 0, bundle.name);
    assert.ok(Array.isArray(bundle.warnings), bundle.name);
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
