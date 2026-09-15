import test from "node:test";import assert from "node:assert/strict";import {canEnrichSelectedTopic} from "./bulk-topic-enrichment.ts";
import { assertEnrichmentSucceeded } from "./bulk-topic-enrichment.ts";
test("returned enrichment failures fail the queue job instead of reporting success", () => {
  assert.throws(() => assertEnrichmentSucceeded({enrichmentStatus:"failed"}), /topic_enrichment_failed/);
  assert.throws(() => assertEnrichmentSucceeded({enrichmentStatus:"pending"}), /incomplete/);
  assert.doesNotThrow(() => assertEnrichmentSucceeded({enrichmentStatus:"completed"}));
  assert.doesNotThrow(() => assertEnrichmentSucceeded({enrichmentStatus:"review_required"}));
});
test("bulk enrichment allows discovered and failed topics but protects accepted and active content",()=>{for(const status of ["none","failed"])assert.equal(canEnrichSelectedTopic({reviewStatus:"needs_review",enrichmentStatus:status}),true);for(const status of ["pending","completed","review_required"])assert.equal(canEnrichSelectedTopic({reviewStatus:"needs_review",enrichmentStatus:status}),false);for(const reviewStatus of ["approved","rejected"])assert.equal(canEnrichSelectedTopic({reviewStatus,enrichmentStatus:"none"}),false);});
