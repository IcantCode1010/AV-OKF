import assert from "node:assert/strict";
import test from "node:test";

import { selectionMetadataSchema } from "./export.ts";

test("EFB selection requires aircraft, ATA chapter, and audience metadata", () => {
  const metadata = selectionMetadataSchema.parse({
    aircraftFamily: "boeing-737-next-generation",
    aircraftTypeIds: ["b738"],
    ataChapter: "36",
    audiences: ["maintenance"],
    qrhTargetId: null,
  });

  assert.deepEqual(metadata, {
    aircraftFamily: "737-ng",
    aircraftTypeIds: ["b738"],
    ataChapter: "36",
    audiences: ["maintenance"],
    qrhTargetId: null,
  });
});

test("EFB selection rejects a non-ATA source identifier", () => {
  assert.throws(() => selectionMetadataSchema.parse({
    aircraftFamily: "737-ng",
    aircraftTypeIds: ["b738"],
    ataChapter: "737SAR",
    audiences: ["pilot"],
    qrhTargetId: "hydraulics",
  }));
});

test("pilot and dual-audience selections require separate placement metadata", () => {
  assert.deepEqual(selectionMetadataSchema.parse({
    aircraftFamily: "737-ng",
    aircraftTypeIds: [],
    ataChapter: null,
    audiences: ["pilot"],
    qrhTargetId: "hydraulics",
  }), {
    aircraftFamily: "737-ng",
    aircraftTypeIds: [],
    ataChapter: null,
    audiences: ["pilot"],
    qrhTargetId: "hydraulics",
  });
  assert.throws(() => selectionMetadataSchema.parse({
    aircraftFamily: "737-ng",
    aircraftTypeIds: [],
    ataChapter: "29",
    audiences: ["pilot", "maintenance"],
    qrhTargetId: null,
  }));
});
