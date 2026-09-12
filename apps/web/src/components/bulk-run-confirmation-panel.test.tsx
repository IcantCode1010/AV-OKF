import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BulkRunConfirmationPanel } from "./bulk-run-confirmation-panel.tsx";

test("bulk confirmation makes the second required action explicit", () => {
  const markup = renderToStaticMarkup(
    createElement(BulkRunConfirmationPanel, {
      bundleId: "bundle-737",
      itemCount: 62,
      runId: "run-1",
      sharedPagePairCount: 51,
    }),
  );

  assert.match(markup, /Step 2 of 2/);
  assert.match(markup, /Confirm and start approval/);
  assert.match(markup, /62 topics are ready/);
  assert.match(markup, /Nothing has been approved or exported yet/);
  assert.match(markup, /Start approval and export/);
  assert.match(markup, /51 selected topic pairs share source pages/);
  assert.match(markup, /name="knowledgeBundleId" value="bundle-737"/);
  assert.match(markup, /name="runId" value="run-1"/);
});
