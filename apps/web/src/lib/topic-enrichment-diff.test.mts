import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcceptedTopicEnrichmentSnapshot,
  buildTopicEnrichmentDiff,
  hasExistingTopicEnrichment,
  normalizeTopicEnrichmentSnapshot,
  topicEnrichmentSnapshotFingerprint,
} from "./topic-enrichment-diff.ts";

test("first enrichment baseline preserves raw content without treating it as enriched", () => {
  const topic = {
    enrichedBody: null,
    enrichedSummary: null,
    enrichedTitle: null,
    proposedSourcePageNumbers: [],
    summary: "Raw summary",
    title: "Raw title",
  };

  assert.equal(hasExistingTopicEnrichment(topic), false);
  assert.deepEqual(buildAcceptedTopicEnrichmentSnapshot(topic), {
    body: "Raw summary",
    proposedSourcePageNumbers: [],
    summary: "Raw summary",
    title: "Raw title",
  });
});

test("re-enrichment baseline uses the last accepted enriched revision", () => {
  const topic = {
    enrichedBody: "Accepted article",
    enrichedSummary: "Accepted summary",
    enrichedTitle: "Accepted title",
    proposedSourcePageNumbers: [4],
    summary: "Raw summary",
    title: "Raw title",
  };

  assert.equal(hasExistingTopicEnrichment(topic), true);
  assert.deepEqual(buildAcceptedTopicEnrichmentSnapshot(topic), {
    body: "Accepted article",
    proposedSourcePageNumbers: [4],
    summary: "Accepted summary",
    title: "Accepted title",
  });
});

test("diff reports content and source-page changes deterministically", () => {
  const result = buildTopicEnrichmentDiff(
    {
      body: "Short accepted article.",
      proposedSourcePageNumbers: [2, 4],
      summary: "Accepted summary",
      title: "Accepted title",
    },
    {
      body: "A longer proposed article with more detail.",
      proposedSourcePageNumbers: [4, 6],
      summary: "Proposed summary",
      title: "Proposed title",
    },
  );

  assert.deepEqual(result, {
    addedSourcePageNumbers: [6],
    afterWordCount: 7,
    beforeWordCount: 3,
    bodyChanged: true,
    changed: true,
    removedSourcePageNumbers: [2],
    summaryChanged: true,
    titleChanged: true,
    wordCountDelta: 4,
  });
});

test("normalization prevents whitespace-only reruns from creating review work", () => {
  const before = {
    body: "Line one.\r\nLine two.",
    proposedSourcePageNumbers: [3, 2, 3],
    summary: " Summary ",
    title: "Title",
  };
  const after = {
    body: "Line one.\nLine two.  \n",
    proposedSourcePageNumbers: [2, 3],
    summary: "Summary",
    title: "Title ",
  };

  assert.equal(buildTopicEnrichmentDiff(before, after).changed, false);
  assert.equal(
    topicEnrichmentSnapshotFingerprint(before),
    topicEnrichmentSnapshotFingerprint(after),
  );
  assert.deepEqual(normalizeTopicEnrichmentSnapshot(before), {
    body: "Line one.\nLine two.",
    proposedSourcePageNumbers: [2, 3],
    summary: "Summary",
    title: "Title",
  });
});
