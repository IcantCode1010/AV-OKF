import assert from "node:assert/strict";
import test from "node:test";

import { buildDeterministicRelationCandidates } from "./okf-relation-discovery.ts";

test("relation discovery requires multiple deterministic signals and stays review-only", () => {
  const candidates = buildDeterministicRelationCandidates([
    { filePath: "concepts/system/brakes.md", pages: [10], sourceFile: "manual.pdf", tags: ["safety"], terms: ["brake", "inspection"] },
    { filePath: "procedures/procedure/prestart.md", pages: [12], sourceFile: "manual.pdf", tags: ["safety"], terms: ["vehicle", "inspection"] },
    { filePath: "concepts/system/unrelated.md", pages: [80], sourceFile: "other.pdf", tags: ["finance"], terms: ["invoice"] },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.relation, "supports");
  assert.deepEqual(candidates[0]?.signals, ["shared_source_file", "shared_tags", "title_description_overlap", "source_page_proximity"]);
  assert.equal("status" in (candidates[0] ?? {}), false);
});
