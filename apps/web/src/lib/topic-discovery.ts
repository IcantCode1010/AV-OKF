import { Output, generateText } from "ai";
import { z } from "zod";

import type { ExtractedPageRecord } from "./document-vault.ts";
import { getSdkModel, type LlmProviderId } from "./llm-providers.ts";

const DEFAULT_WINDOW_TOKEN_TARGET = 18_000;
const DEFAULT_WINDOW_PAGE_LIMIT = 20;
const WINDOW_MAX_OUTPUT_TOKENS = 4_000;
const CONSOLIDATION_MAX_OUTPUT_TOKENS = 16_000;
const CONTINUATION_BOUNDARY_LINE_LIMIT = 8;
export const TOPIC_CONTINUATION_RESOLVER_VERSION = "explicit-continuation-v1";

const CONTINUATION_CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "continued",
  "continuation",
  "contd",
  "for",
  "of",
  "or",
  "the",
  "to",
]);

const candidateSchema = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  evidenceHeadings: z.array(z.string()),
  pageNumbers: z.array(z.number().int().positive()).min(1),
  rationale: z.string(),
  summary: z.string(),
  title: z.string(),
  topicType: z.string(),
});

const candidateListSchema = z.object({ topics: z.array(candidateSchema) });

export type DiscoveredTopic = z.infer<typeof candidateSchema>;
export type TopicDiscoveryStage = "window" | "consolidation";

export type TopicContinuationEvidence = {
  backwardMarker: string;
  forwardMarker: string;
  fromPage: number;
  toPage: number;
};

export type ContinuationAmbiguity = TopicContinuationEvidence & {
  candidateTitles: string[];
  reason: "multiple_topic_candidates";
};

export type ResolvedDiscoveredTopic<Topic extends DiscoveredTopic = DiscoveredTopic> = Topic & {
  continuationAmbiguities: ContinuationAmbiguity[];
  continuationEvidence: TopicContinuationEvidence[];
};

export type TopicDiscoveryProvider = {
  model: string;
  provider: LlmProviderId;
  discover(input: {
    prompt: string;
    stage: TopicDiscoveryStage;
  }): Promise<{ output: unknown; rawResponse: string }>;
};

export type TopicDiscoveryAuditEntry = {
  errorMessage: string | null;
  promptSent: string;
  rawResponse: string;
  stage: TopicDiscoveryStage;
  succeeded: boolean;
  windowOrdinal: number | null;
};

export type TopicDiscoveryResult = {
  audits: TopicDiscoveryAuditEntry[];
  continuationAmbiguities: ContinuationAmbiguity[];
  estimatedInputTokens: number;
  topics: ResolvedDiscoveredTopic[];
  totalWindows: number;
};

export function getTopicDiscoveryMaxOutputTokens(stage: TopicDiscoveryStage) {
  return stage === "window"
    ? WINDOW_MAX_OUTPUT_TOKENS
    : CONSOLIDATION_MAX_OUTPUT_TOKENS;
}

export async function discoverDocumentTopics(input: {
  documentTitle: string;
  onWindowComplete?: (completed: number, total: number) => Promise<void> | void;
  pages: ExtractedPageRecord[];
  provider: TopicDiscoveryProvider;
  tokenTarget?: number;
}): Promise<TopicDiscoveryResult> {
  const pages = preparePages(input.pages);
  if (pages.length === 0) throw new Error("topic_discovery_requires_extracted_pages");

  const windows = buildPageWindows(pages, input.tokenTarget);
  const audits: TopicDiscoveryAuditEntry[] = [];
  const proposals: DiscoveredTopic[] = [];

  for (const [index, window] of windows.entries()) {
    const prompt = buildWindowPrompt(input.documentTitle, window, index, windows.length);
    try {
      const result = await input.provider.discover({ prompt, stage: "window" });
      const parsed = candidateListSchema.parse(result.output);
      proposals.push(...parsed.topics);
      audits.push({
        errorMessage: null,
        promptSent: prompt,
        rawResponse: result.rawResponse,
        stage: "window",
        succeeded: true,
        windowOrdinal: index,
      });
      await input.onWindowComplete?.(index + 1, windows.length);
    } catch (error) {
      audits.push({
        errorMessage: normalizeError(error),
        promptSent: prompt,
        rawResponse: error instanceof Error ? error.message : String(error),
        stage: "window",
        succeeded: false,
        windowOrdinal: index,
      });
      throw new TopicDiscoveryError("topic_discovery_window_failed", audits);
    }
  }

  const consolidationPrompt = buildConsolidationPrompt(
    input.documentTitle,
    pages,
    proposals,
  );
  try {
    const result = await input.provider.discover({
      prompt: consolidationPrompt,
      stage: "consolidation",
    });
    const parsed = candidateListSchema.parse(result.output);
    const continuationResult = resolveExplicitTopicContinuations({
      pages,
      topics: parsed.topics,
    });
    const topics = validateDiscoveredTopics(continuationResult.topics, pages);
    audits.push({
      errorMessage: null,
      promptSent: consolidationPrompt,
      rawResponse: result.rawResponse,
      stage: "consolidation",
      succeeded: true,
      windowOrdinal: null,
    });
    return {
      audits,
      continuationAmbiguities: continuationResult.ambiguities,
      estimatedInputTokens: estimateTokens(pages.map((page) => page.text).join("\n")),
      topics,
      totalWindows: windows.length,
    };
  } catch (error) {
    audits.push({
      errorMessage: normalizeError(error),
      promptSent: consolidationPrompt,
      rawResponse: error instanceof Error ? error.message : String(error),
      stage: "consolidation",
      succeeded: false,
      windowOrdinal: null,
    });
    throw new TopicDiscoveryError("topic_discovery_consolidation_failed", audits);
  }
}

export function createSdkTopicDiscoveryProvider(input: {
  apiKey: string;
  model: string;
  provider: LlmProviderId;
}): TopicDiscoveryProvider {
  return {
    model: input.model,
    provider: input.provider,
    async discover({ prompt, stage }) {
      const result = await generateText({
        maxOutputTokens: getTopicDiscoveryMaxOutputTokens(stage),
        model: getSdkModel(input.provider, input.apiKey),
        output: Output.object({ schema: candidateListSchema }),
        prompt,
        system:
          "You identify meaningful topics in documents. Use only supplied text and return the requested structured object.",
        temperature: 0,
      });
      return { output: result.output, rawResponse: JSON.stringify(result.output) };
    },
  };
}

export function buildPageWindows(
  pages: ExtractedPageRecord[],
  tokenTarget = DEFAULT_WINDOW_TOKEN_TARGET,
): ExtractedPageRecord[][] {
  const windows: ExtractedPageRecord[][] = [];
  let current: ExtractedPageRecord[] = [];
  let tokens = 0;

  for (const page of pages) {
    const pageTokens = estimateTokens(page.text);
    if (
      current.length > 0 &&
      (tokens + pageTokens > tokenTarget || current.length >= DEFAULT_WINDOW_PAGE_LIMIT)
    ) {
      windows.push(current);
      current = [current.at(-1)!, page];
      tokens = estimateTokens(current.map((item) => item.text).join("\n"));
    } else {
      current.push(page);
      tokens += pageTokens;
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

export function validateDiscoveredTopics<Topic extends DiscoveredTopic>(
  topics: Topic[],
  pages: ExtractedPageRecord[],
): Topic[] {
  const validPages = new Set(pages.map((page) => page.pageNumber));
  const titles = new Set<string>();
  const accepted: Topic[] = [];

  for (const topic of topics) {
    const title = normalizeTitle(topic.title);
    const summary = topic.summary.trim();
    const pageNumbers = [...new Set(topic.pageNumbers)]
      .filter((page) => validPages.has(page))
      .sort((left, right) => left - right);
    const key = title.toLocaleLowerCase();
    if (!title || !summary || pageNumbers.length === 0 || isJunkTitle(title) || titles.has(key)) {
      continue;
    }
    titles.add(key);
    accepted.push({
      ...topic,
      evidenceHeadings: topic.evidenceHeadings.map((value) => value.trim()).filter(Boolean),
      pageNumbers,
      rationale: topic.rationale.trim(),
      summary,
      title,
      topicType: normalizeTopicType(topic.topicType),
    });
  }
  if (accepted.length === 0) throw new Error("topic_discovery_no_valid_topics");
  return accepted.sort((left, right) => left.pageNumbers[0]! - right.pageNumbers[0]! || left.title.localeCompare(right.title));
}

export function resolveExplicitTopicContinuations<Topic extends DiscoveredTopic>(input: {
  pages: ExtractedPageRecord[];
  topics: Topic[];
}): { ambiguities: ContinuationAmbiguity[]; topics: ResolvedDiscoveredTopic<Topic>[] } {
  const topics = input.topics.map<ResolvedDiscoveredTopic<Topic>>((topic) => ({
    ...topic,
    continuationAmbiguities: [],
    continuationEvidence: [],
    pageNumbers: uniqueSortedNumbers(topic.pageNumbers),
  }));
  const pages = new Map(input.pages.map((page) => [page.pageNumber, page]));
  const evidenceByTopic = topics.map(() => new Map<string, TopicContinuationEvidence>());
  const ambiguityByTopic = topics.map(() => new Map<string, ContinuationAmbiguity>());
  const ambiguities = new Map<string, ContinuationAmbiguity>();
  const boundaries = [...pages.keys()]
    .sort((left, right) => left - right)
    .flatMap((fromPage) => {
      const toPage = fromPage + 1;
      const current = pages.get(fromPage);
      const next = pages.get(toPage);
      if (!current || !next) return [];
      const forwardMarker = findForwardContinuationMarker(current.text);
      const backwardMarker = findBackwardContinuationMarker(next.text);
      if (!forwardMarker || !backwardMarker) return [];
      return [{ backwardMarker, forwardMarker, fromPage, toPage }];
    });

  let changed = true;
  while (changed) {
    changed = false;
    for (const boundary of boundaries) {
      const candidates = topics
        .map((topic, index) => ({ index, topic }))
        .filter(({ topic }) => isTopicAtBoundary(topic, boundary.fromPage, boundary.toPage));
      const markerLabels = [
        boundary.forwardMarker.labelTokens,
        boundary.backwardMarker.labelTokens,
      ].filter((tokens) => tokens.length > 0);
      if (markerLabels.length === 2 && !areMarkerLabelsCompatible(markerLabels[0]!, markerLabels[1]!)) {
        continue;
      }
      const matched = filterContinuationCandidates(candidates, markerLabels);
      if (matched.length === 0) continue;

      const evidence: TopicContinuationEvidence = {
        backwardMarker: boundary.backwardMarker.raw,
        forwardMarker: boundary.forwardMarker.raw,
        fromPage: boundary.fromPage,
        toPage: boundary.toPage,
      };
      const key = continuationBoundaryKey(evidence);
      if (matched.length > 1) {
        const ambiguity: ContinuationAmbiguity = {
          ...evidence,
          candidateTitles: matched.map(({ topic }) => topic.title).sort(),
          reason: "multiple_topic_candidates",
        };
        ambiguities.set(key, ambiguity);
        for (const candidate of matched) {
          ambiguityByTopic[candidate.index]!.set(key, ambiguity);
        }
        continue;
      }

      const selected = matched[0]!;
      evidenceByTopic[selected.index]!.set(key, evidence);
      ambiguityByTopic[selected.index]!.delete(key);
      ambiguities.delete(key);
      const pageNumbers = new Set(selected.topic.pageNumbers);
      const before = pageNumbers.size;
      pageNumbers.add(boundary.fromPage);
      pageNumbers.add(boundary.toPage);
      if (pageNumbers.size !== before) {
        selected.topic.pageNumbers = [...pageNumbers].sort((left, right) => left - right);
        changed = true;
      }
    }
  }

  topics.forEach((topic, index) => {
    topic.continuationEvidence = [...evidenceByTopic[index]!.values()].sort(compareContinuationEvidence);
    topic.continuationAmbiguities = [...ambiguityByTopic[index]!.values()].sort(compareContinuationEvidence);
  });
  return {
    ambiguities: [...ambiguities.values()].sort(compareContinuationEvidence),
    topics,
  };
}

export class TopicDiscoveryError extends Error {
  readonly audits: TopicDiscoveryAuditEntry[];

  constructor(message: string, audits: TopicDiscoveryAuditEntry[]) {
    super(message);
    this.audits = audits;
  }
}

function preparePages(pages: ExtractedPageRecord[]) {
  const repeated = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text.split("\n").map(normalizeLine).filter(Boolean);
    for (const line of [...lines.slice(0, 3), ...lines.slice(-3)]) {
      repeated.set(line, (repeated.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => {
      const lines = page.text.split("\n");
      const filtered = lines.filter((line, index) => {
        const normalized = normalizeLine(line);
        const boundary = index < 3 || index >= lines.length - 3;
        return !(boundary && (repeated.get(normalized) ?? 0) >= threshold);
      });
      return { ...page, text: filtered.join("\n").trim() };
    })
    .filter((page) => page.text.length > 0);
}

function buildWindowPrompt(title: string, pages: ExtractedPageRecord[], index: number, total: number) {
  return [
    `Document: ${title}`,
    `Window ${index + 1} of ${total}.`,
    "Identify meaningful section-level topics. Merge continuation pages within this window.",
    "Create concise noun-phrase or procedure titles and brief factual summaries.",
    "Never use page numbers, fractions, bullets, warnings, sentence fragments, or isolated codes as titles.",
    "Return source page numbers, evidence headings, rationale, topic type, and low/medium/high confidence.",
    "Use only the supplied text.",
    ...pages.map((page) => `\n--- PAGE ${page.pageNumber} ---\n${page.text}`),
  ].join("\n");
}

function buildConsolidationPrompt(title: string, pages: ExtractedPageRecord[], proposals: DiscoveredTopic[]) {
  const outline = pages.map((page) => {
    const lines = page.text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4);
    return `Page ${page.pageNumber}: ${lines.join(" | ").slice(0, 500)}`;
  });
  return [
    `Document: ${title}`,
    "Consolidate the candidate topics into the final document-wide section-level topic list.",
    "Merge duplicates and sections continued across pages. Keep genuinely distinct subjects separate.",
    "Correct fragmented titles. Preserve exact identifiers only when they are part of a meaningful title.",
    "Every fact and source page must be supported by the supplied outline/candidates.",
    "Document outline:",
    ...outline,
    "\nWindow candidates:",
    JSON.stringify(proposals),
  ].join("\n");
}

function findForwardContinuationMarker(text: string): {
  labelTokens: string[];
  raw: string;
} | null {
  const lines = boundaryLines(text).slice(-CONTINUATION_BOUNDARY_LINE_LIMIT).reverse();
  for (const line of lines) {
    const match = line.match(
      /^(.*?)[\s:;,.–—-]*(?:continue|continued|continues)\s+(?:(?:on\s+)?(?:the\s+)?next\s+page|overleaf)\s*$/i,
    );
    if (!match) continue;
    return {
      labelTokens: canonicalContinuationTokens(match[1] ?? ""),
      raw: line,
    };
  }
  return null;
}

function findBackwardContinuationMarker(text: string): {
  labelTokens: string[];
  raw: string;
} | null {
  const lines = boundaryLines(text).slice(0, CONTINUATION_BOUNDARY_LINE_LIMIT);
  for (const line of lines) {
    if (/\bnext\s+page\b/i.test(line)) continue;
    const match = line.match(
      /^(.*?)[\s:;,.\-–—]*[([]?\s*(?:continued|continuation|cont\s*['’]?\s*d)(?:\s+from\s+(?:the\s+)?previous\s+page)?\s*[)\]]?\s*$/i,
    );
    if (!match) continue;
    return {
      labelTokens: canonicalContinuationTokens(match[1] ?? ""),
      raw: line,
    };
  }
  return null;
}

function boundaryLines(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function canonicalContinuationTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !CONTINUATION_CONNECTOR_WORDS.has(token));
}

function filterContinuationCandidates(
  candidates: Array<{ index: number; topic: ResolvedDiscoveredTopic }>,
  markerLabels: string[][],
) {
  if (markerLabels.length === 0) return candidates;
  return candidates.filter(({ topic }) =>
    markerLabels.every((labelTokens) => topicMatchesMarkerLabel(topic, labelTokens))
  );
}

function topicMatchesMarkerLabel(
  topic: ResolvedDiscoveredTopic,
  labelTokens: string[],
) {
  if (labelTokens.length === 1) {
    return topic.evidenceHeadings.some((heading) => {
      const headingTokens = canonicalContinuationTokens(heading);
      return headingTokens.length === 1 && headingTokens[0] === labelTokens[0];
    });
  }
  return [topic.title, ...topic.evidenceHeadings].some((value) => {
    const candidateTokens = canonicalContinuationTokens(value);
    return containsTokenSequence(candidateTokens, labelTokens) ||
      containsTokenSequence(labelTokens, candidateTokens);
  });
}

function areMarkerLabelsCompatible(left: string[], right: string[]) {
  if (left.length === 1 || right.length === 1) {
    return left.length === right.length && left[0] === right[0];
  }
  return containsTokenSequence(left, right) || containsTokenSequence(right, left);
}

function containsTokenSequence(values: string[], expected: string[]): boolean {
  if (expected.length < 2 || expected.length > values.length) return false;
  for (let start = 0; start <= values.length - expected.length; start += 1) {
    if (expected.every((token, index) => values[start + index] === token)) return true;
  }
  return false;
}

function isTopicAtBoundary(
  topic: ResolvedDiscoveredTopic,
  fromPage: number,
  toPage: number,
): boolean {
  const pages = topic.pageNumbers;
  if (pages.includes(fromPage) && pages.includes(toPage)) return true;
  if (pages.at(-1) === fromPage && !pages.includes(toPage)) return true;
  return pages[0] === toPage && !pages.includes(fromPage);
}

function continuationBoundaryKey(value: { fromPage: number; toPage: number }) {
  return `${value.fromPage}:${value.toPage}`;
}

function compareContinuationEvidence(
  left: { fromPage: number; toPage: number },
  right: { fromPage: number; toPage: number },
) {
  return left.fromPage - right.fromPage || left.toPage - right.toPage;
}

function uniqueSortedNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalizeTitle(value: string) {
  return value.replace(/^[-•*\s]+/, "").replace(/\s+/g, " ").trim().replace(/[,:;]$/, "");
}

function isJunkTitle(value: string) {
  if (value.length < 4 || value.length > 140) return true;
  if (/^\d+(?:[./-]\d+)*$/.test(value)) return true;
  if (/^(?:page|figure|table)\s+\d+/i.test(value)) return true;
  if (/^(?:warning|caution|note)\s*:/i.test(value)) return true;
  if (/^[a-z]/.test(value) || /[.!?]$/.test(value)) return true;
  return value.split(/\s+/).length > 18;
}

function normalizeTopicType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return normalized || "system_topic";
}

function normalizeLine(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
