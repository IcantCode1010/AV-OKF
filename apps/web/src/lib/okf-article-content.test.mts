import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOkfArticleReaderContent,
  normalizeOkfArticleBody,
  normalizeOkfArticleComparison,
} from "./okf-article-content.ts";

test("article comparison uses exact normalized equality", () => {
  assert.equal(
    normalizeOkfArticleComparison("  Smoke, Fire OR Fumes  "),
    "smoke fire or fumes",
  );
  assert.notEqual(
    normalizeOkfArticleComparison("Brake cooling prevents overheating."),
    normalizeOkfArticleComparison("Brake cooling helps prevent overheating."),
  );
});

test("article normalization removes only matching leading H1 headings", () => {
  const result = normalizeOkfArticleBody({
    body: "# APU Fire Response\n\n# APU Fire Response!\n\n## Condition\nFire detected.",
    title: "APU Fire Response",
  });
  assert.equal(result.removedLeadingTitleCount, 2);
  assert.equal(result.body, "## Condition\nFire detected.");

  const distinct = normalizeOkfArticleBody({
    body: "# Related Emergency Procedures\n\nImportant content.",
    title: "APU Fire Response",
  });
  assert.equal(distinct.removedLeadingTitleCount, 0);
  assert.match(distinct.body, /^# Related Emergency Procedures/);
});

test("article normalization removes only the final Source section", () => {
  const result = normalizeOkfArticleBody({
    body: "## Procedure\nDo the work.\n\n## Source\n\n- manual.pdf, page 4\n",
    title: "Procedure",
  });
  assert.equal(result.removedTrailingSource, true);
  assert.equal(result.body, "## Procedure\nDo the work.");

  const middleSource = normalizeOkfArticleBody({
    body: "## Source\nSystem input.\n\n## Result\nSystem output.",
    title: "Data flow",
  });
  assert.equal(middleSource.removedTrailingSource, false);
  assert.match(middleSource.body, /## Source/);
});

test("reader suppresses descriptions only for exact normalized paragraph matches", () => {
  const exact = buildOkfArticleReaderContent({
    body: "# Inspection\n\nChecks required before operating the vehicle.\n\n## Steps\nInspect it.",
    description: "Checks required before operating the vehicle!",
    title: "Inspection",
  });
  assert.equal(exact.descriptionRepeatedExactly, true);

  const similar = buildOkfArticleReaderContent({
    body: "Checks required before safely operating the vehicle.",
    description: "Checks required before operating the vehicle.",
    title: "Inspection",
  });
  assert.equal(similar.descriptionRepeatedExactly, false);
});

test("reader preserves tables, nested headings, and non-aviation content", () => {
  const result = buildOkfArticleReaderContent({
    body: "# Vehicle Inspection\n\n## Checklist\n\n| Item | State |\n| --- | --- |\n| Tires | Ready |",
    description: "Vehicle checks.",
    title: "Vehicle Inspection",
  });
  assert.equal(result.body, "## Checklist\n\n| Item | State |\n| --- | --- |\n| Tires | Ready |");
});
