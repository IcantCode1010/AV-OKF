import assert from "node:assert/strict";
import test from "node:test";

import { selectionMetadataSchema } from "./export.ts";

test("EFB selection requires aircraft, ATA chapter, and audience metadata", () => {
  const metadata = selectionMetadataSchema.parse({
    aircraftFamily: "boeing-737-next-generation",
    aircraftTypeIds: ["b738"],
    ataChapter: "36",
    audiences: ["maintenance"],
  });

  assert.deepEqual(metadata, {
    aircraftFamily: "737-ng",
    aircraftTypeIds: ["b738"],
    ataChapter: "36",
    audiences: ["maintenance"],
  });
});

test("EFB selection rejects a non-ATA source identifier", () => {
  assert.throws(() => selectionMetadataSchema.parse({
    aircraftFamily: "737-ng",
    aircraftTypeIds: ["b738"],
    ataChapter: "737SAR",
    audiences: ["pilot"],
  }));
});
