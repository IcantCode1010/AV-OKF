import { Output, generateText } from "ai";
import { z } from "zod";

import type { ExtractedPageRecord } from "./document-vault.ts";
import { getSdkModel, type LlmProviderId } from "./llm-providers.ts";

const DEFAULT_WINDOW_TOKEN_TARGET = 18_000;
const DEFAULT_WINDOW_PAGE_LIMIT = 20;

const candidateSchema = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  evidenceHeadings: z.array(z.string()).default([]),
  pageNumbers: z.array(z.number().int().positive()).min(1),
  rationale: z.string(),
  summary: z.string(),
  title: z.string(),
  topicType: z.string().default("system_topic"),
});

const candidateListSchema = z.object({ topics: z.array(candidateSchema) });

export type DiscoveredTopic = z.infer<typeof candidateSchema>;
export type TopicDiscoveryStage = "window" | "consolidation";

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
  estimatedInputTokens: number;
  topics: DiscoveredTopic[];
  totalWindows: number;
};

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
    const topics = validateDiscoveredTopics(parsed.topics, pages);
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
        maxOutputTokens: stage === "window" ? 4_000 : 8_000,
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

export function validateDiscoveredTopics(
  topics: DiscoveredTopic[],
  pages: ExtractedPageRecord[],
): DiscoveredTopic[] {
  const validPages = new Set(pages.map((page) => page.pageNumber));
  const titles = new Set<string>();
  const accepted: DiscoveredTopic[] = [];

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
