import { createHash } from "node:crypto";

export type TopicEnrichmentSnapshot = {
  body: string;
  proposedSourcePageNumbers: number[];
  summary: string;
  title: string;
};

export type TopicEnrichmentDiff = {
  addedSourcePageNumbers: number[];
  afterWordCount: number;
  beforeWordCount: number;
  bodyChanged: boolean;
  changed: boolean;
  removedSourcePageNumbers: number[];
  summaryChanged: boolean;
  titleChanged: boolean;
  wordCountDelta: number;
};

export type TopicEnrichmentFields = {
  enrichedBody?: string | null;
  enrichedSummary?: string | null;
  enrichedTitle?: string | null;
  proposedSourcePageNumbers?: number[];
  summary: string;
  title: string;
};

export function hasExistingTopicEnrichment(topic: TopicEnrichmentFields) {
  return Boolean(
    topic.enrichedTitle?.trim() ||
    topic.enrichedSummary?.trim() ||
    topic.enrichedBody?.trim(),
  );
}

export function buildAcceptedTopicEnrichmentSnapshot(
  topic: TopicEnrichmentFields,
): TopicEnrichmentSnapshot {
  return normalizeTopicEnrichmentSnapshot({
    body: topic.enrichedBody ?? topic.enrichedSummary ?? topic.summary,
    proposedSourcePageNumbers: topic.proposedSourcePageNumbers ?? [],
    summary: topic.enrichedSummary ?? topic.summary,
    title: topic.enrichedTitle ?? topic.title,
  });
}

export function normalizeTopicEnrichmentSnapshot(
  snapshot: TopicEnrichmentSnapshot,
): TopicEnrichmentSnapshot {
  return {
    body: normalizeText(snapshot.body),
    proposedSourcePageNumbers: [...new Set(snapshot.proposedSourcePageNumbers)]
      .filter((page) => Number.isInteger(page) && page > 0)
      .sort((left, right) => left - right),
    summary: normalizeText(snapshot.summary),
    title: normalizeText(snapshot.title),
  };
}

export function topicEnrichmentSnapshotFingerprint(
  snapshot: TopicEnrichmentSnapshot,
) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeTopicEnrichmentSnapshot(snapshot)))
    .digest("hex");
}

export function buildTopicEnrichmentDiff(
  beforeInput: TopicEnrichmentSnapshot,
  afterInput: TopicEnrichmentSnapshot,
): TopicEnrichmentDiff {
  const before = normalizeTopicEnrichmentSnapshot(beforeInput);
  const after = normalizeTopicEnrichmentSnapshot(afterInput);
  const beforeWordCount = countWords(before.body);
  const afterWordCount = countWords(after.body);
  const beforePages = new Set(before.proposedSourcePageNumbers);
  const afterPages = new Set(after.proposedSourcePageNumbers);
  const addedSourcePageNumbers = after.proposedSourcePageNumbers.filter(
    (page) => !beforePages.has(page),
  );
  const removedSourcePageNumbers = before.proposedSourcePageNumbers.filter(
    (page) => !afterPages.has(page),
  );
  const titleChanged = before.title !== after.title;
  const summaryChanged = before.summary !== after.summary;
  const bodyChanged = before.body !== after.body;

  return {
    addedSourcePageNumbers,
    afterWordCount,
    beforeWordCount,
    bodyChanged,
    changed:
      titleChanged ||
      summaryChanged ||
      bodyChanged ||
      addedSourcePageNumbers.length > 0 ||
      removedSourcePageNumbers.length > 0,
    removedSourcePageNumbers,
    summaryChanged,
    titleChanged,
    wordCountDelta: afterWordCount - beforeWordCount,
  };
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function countWords(value: string) {
  return value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
