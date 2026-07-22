import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOkfArticleRepairAcknowledgement,
  buildOkfArticleRepairReport,
  getRepairedEnrichedBody,
  type OkfArticleRepairCandidate,
} from "./okf-article-repair.ts";

const candidate: OkfArticleRepairCandidate = {
  approvalMode: "human_individual",
  enrichedBody: "# Vehicle Inspection\n\n## Checklist\nInspect the vehicle.",
  exportedFilePath: "concepts/procedure/vehicle-inspection.md",
  exportedMarkdown: `---
type: procedure
title: Vehicle Inspection
---

# Vehicle Inspection

# Vehicle Inspection

## Checklist
Inspect the vehicle.

## Source
- vehicle.pdf, page 1
`,
  relations: [],
  reviewStatus: "approved",
  sourcePageNumbers: [1],
  summary: "Inspect before use.",
  title: "Vehicle Inspection",
  topicId: "topic-1",
};

test("repair report identifies stored and exported duplicate framing", () => {
  const report = buildOkfArticleRepairReport({
    bundleId: "bundle-1",
    candidates: [candidate],
    workspaceId: "workspace-1",
  });
  assert.equal(report.itemCount, 1);
  assert.equal(report.changedCount, 1);
  assert.equal(report.items[0]?.storedBody.removedLeadingTitleCount, 1);
  assert.equal(report.items[0]?.exportedFile.leadingMatchingTitleCount, 2);
  assert.equal(report.items[0]?.exportedFile.hasCanonicalSource, true);
  assert.equal(getRepairedEnrichedBody(candidate), "## Checklist\nInspect the vehicle.");
});

test("repair report is deterministic and canonical content is a no-op", () => {
  const canonical = {
    ...candidate,
    enrichedBody: "## Checklist\nInspect the vehicle.",
    exportedMarkdown: `---
type: procedure
title: Vehicle Inspection
---

# Vehicle Inspection

## Checklist
Inspect the vehicle.

## Source
- vehicle.pdf, page 1
`,
  };
  const first = buildOkfArticleRepairReport({
    bundleId: "bundle-1",
    candidates: [canonical],
    workspaceId: "workspace-1",
  });
  const second = buildOkfArticleRepairReport({
    bundleId: "bundle-1",
    candidates: [canonical],
    workspaceId: "workspace-1",
  });
  assert.equal(first.reportHash, second.reportHash);
  assert.equal(first.changedCount, 0);
});

test("repair apply acknowledgement must match the current report hash", () => {
  const report = buildOkfArticleRepairReport({
    bundleId: "bundle-1",
    candidates: [candidate],
    workspaceId: "workspace-1",
  });
  assert.throws(
    () => assertOkfArticleRepairAcknowledgement(report, "stale"),
    /okf_article_repair_requires_matching_acknowledgement/,
  );
  assert.doesNotThrow(() =>
    assertOkfArticleRepairAcknowledgement(report, report.reportHash),
  );
});
