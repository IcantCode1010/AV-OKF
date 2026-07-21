import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageWindows,
  discoverDocumentTopics,
  getTopicDiscoveryMaxOutputTokens,
  resolveExplicitTopicContinuations,
  validateDiscoveredTopics,
  type TopicDiscoveryProvider,
} from "./topic-discovery.ts";

const page = (pageNumber: number, text: string) => ({
  charCount: text.length,
  imageCount: 0,
  pageNumber,
  tables: [],
  text,
});

test("large-document consolidation receives the full structured-output allowance", () => {
  assert.equal(getTopicDiscoveryMaxOutputTokens("window"), 4_000);
  assert.equal(getTopicDiscoveryMaxOutputTokens("consolidation"), 16_000);
});

test("page windows cover every page and overlap at boundaries", () => {
  const pages = [1, 2, 3, 4].map((number) => page(number, "word ".repeat(80)));
  const windows = buildPageWindows(pages, 150);
  assert.deepEqual([...new Set(windows.flat().map((item) => item.pageNumber))], [1, 2, 3, 4]);
  assert.equal(windows[0]!.at(-1)!.pageNumber, windows[1]![0]!.pageNumber);
});

test("validation removes junk and duplicate titles while preserving valid coverage", () => {
  const topics = validateDiscoveredTopics([
    { confidence: "high", evidenceHeadings: [], pageNumbers: [1], rationale: "heading", summary: "Valid.", title: "22", topicType: "system" },
    { confidence: "high", evidenceHeadings: [], pageNumbers: [1, 2], rationale: "section", summary: "Brake operation.", title: "Main Gear Brake System", topicType: "system" },
    { confidence: "medium", evidenceHeadings: [], pageNumbers: [2], rationale: "duplicate", summary: "Duplicate.", title: "Main Gear Brake System", topicType: "system" },
  ], [page(1, "a"), page(2, "b")]);
  assert.equal(topics.length, 1);
  assert.deepEqual(topics[0]!.pageNumbers, [1, 2]);
});

test("document discovery performs window analysis then global consolidation", async () => {
  const calls: string[] = [];
  const provider: TopicDiscoveryProvider = {
    model: "mock-model",
    provider: "openai",
    async discover(input) {
      calls.push(input.stage);
      const topics = input.stage === "window"
        ? [{ confidence: "medium", evidenceHeadings: ["BRAKES"], pageNumbers: [1, 2], rationale: "heading", summary: "Draft.", title: "BRAKES", topicType: "system" }]
        : [{ confidence: "high", evidenceHeadings: ["BRAKES"], pageNumbers: [1, 2], rationale: "continued section", summary: "Describes brake operation and controls.", title: "Brake System Operation", topicType: "system" }];
      return { output: { topics }, rawResponse: JSON.stringify({ topics }) };
    },
  };
  const result = await discoverDocumentTopics({
    documentTitle: "Manual",
    pages: [page(1, "BRAKES\nOperation"), page(2, "BRAKES\nContinued")],
    provider,
    tokenTarget: 10_000,
  });
  assert.deepEqual(calls, ["window", "consolidation"]);
  assert.equal(result.topics[0]!.title, "Brake System Operation");
  assert.deepEqual(result.topics[0]!.pageNumbers, [1, 2]);
});

test("paired labeled markers extend a topic using normalized title tokens", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [
      page(130, "Smoke, Fire or Fumes\nProcedure\n\u0019 Continued on next page \u0019"),
      page(131, "\u0019 SMOKE FIRE FUMES (CONTINUED) \u0019\nRemaining procedure steps"),
    ],
    topics: [topic({ evidenceHeadings: ["Smoke, Fire or Fumes"], pageNumbers: [130], title: "Smoke, Fire or Fumes Response Procedure" })],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [130, 131]);
  assert.deepEqual(result.topics[0]!.continuationEvidence.map(({ fromPage, toPage }) => [fromPage, toPage]), [[130, 131]]);
  assert.equal(result.ambiguities.length, 0);
});

test("continuation requires markers on both adjacent pages", () => {
  const forwardOnly = resolveExplicitTopicContinuations({
    pages: [page(1, "Return policy\nContinued on next page"), page(2, "Remaining policy")],
    topics: [topic({ evidenceHeadings: ["Return Policy"], pageNumbers: [1], title: "Return Policy" })],
  });
  const backwardOnly = resolveExplicitTopicContinuations({
    pages: [page(1, "Return policy"), page(2, "Return Policy continued\nRemaining policy")],
    topics: [topic({ evidenceHeadings: ["Return Policy"], pageNumbers: [1], title: "Return Policy" })],
  });
  assert.deepEqual(forwardOnly.topics[0]!.pageNumbers, [1]);
  assert.deepEqual(backwardOnly.topics[0]!.pageNumbers, [1]);
});

test("one-token labels require an exact evidence heading", () => {
  const accepted = resolveExplicitTopicContinuations({
    pages: [page(1, "Brakes\nContinued overleaf"), page(2, "Brakes continued\nDetails")],
    topics: [topic({ evidenceHeadings: ["BRAKES"], pageNumbers: [1], title: "Brake System Operation" })],
  });
  const rejected = resolveExplicitTopicContinuations({
    pages: [page(1, "Brakes\nContinued overleaf"), page(2, "Brakes continued\nDetails")],
    topics: [topic({ evidenceHeadings: ["Brake System"], pageNumbers: [1], title: "Brake System Operation" })],
  });
  assert.deepEqual(accepted.topics[0]!.pageNumbers, [1, 2]);
  assert.deepEqual(rejected.topics[0]!.pageNumbers, [1]);
});

test("mismatched labeled markers do not extend a topic", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [page(1, "Return policy\nContinued on next page"), page(2, "Warranty Claims continued\nDetails")],
    topics: [topic({ evidenceHeadings: ["Return Policy"], pageNumbers: [1], title: "Return Policy" })],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [1]);
});

test("incompatible forward and backward marker labels do not resolve a broad topic", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [
      page(1, "Return Policy continued on next page"),
      page(2, "Warranty Claims continued\nDetails"),
    ],
    topics: [topic({
      evidenceHeadings: ["Return Policy", "Warranty Claims"],
      pageNumbers: [1],
      title: "Return Policy and Warranty Claims",
    })],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [1]);
});

test("multi-page continuation chains resolve completely", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [
      page(1, "Vehicle Inspection\nContinued on next page"),
      page(2, "Vehicle Inspection continued\nChecks\nContinued on next page"),
      page(3, "Vehicle Inspection continued\nFinal checks"),
    ],
    topics: [topic({ evidenceHeadings: ["Vehicle Inspection"], pageNumbers: [1], title: "Vehicle Inspection Procedure" })],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [1, 2, 3]);
  assert.equal(result.topics[0]!.continuationEvidence.length, 2);
});

test("partial chains retain resolved pages and stop at an ambiguous link", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [
      page(130, "Procedure\nContinued on next page"),
      page(131, "(continued)\nSteps\nContinued on next page"),
      page(132, "(continued)\nMore steps"),
    ],
    topics: [
      topic({ pageNumbers: [130], title: "Procedure Alpha" }),
      topic({ pageNumbers: [132], title: "Procedure Beta" }),
    ],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [130, 131]);
  assert.deepEqual(result.topics[1]!.pageNumbers, [132]);
  assert.equal(result.ambiguities.length, 1);
  assert.deepEqual(result.ambiguities[0]!.candidateTitles, ["Procedure Alpha", "Procedure Beta"]);
});

test("a continuation page remains attributable when a new topic begins later on it", () => {
  const result = resolveExplicitTopicContinuations({
    pages: [
      page(131, "Smoke, Fire or Fumes\nStep 22\nContinued on next page"),
      page(132, "Smoke, Fire or Fumes continued\nSteps 23-25\nAPU Detection Inoperative\nNew procedure"),
    ],
    topics: [topic({ evidenceHeadings: ["Smoke, Fire or Fumes"], pageNumbers: [131], title: "Smoke Fire Fumes Response Procedure" })],
  });
  assert.deepEqual(result.topics[0]!.pageNumbers, [131, 132]);
});

function topic(overrides: Partial<{
  confidence: "low" | "medium" | "high";
  evidenceHeadings: string[];
  pageNumbers: number[];
  rationale: string;
  summary: string;
  title: string;
  topicType: string;
}> = {}) {
  return {
    confidence: "high" as const,
    evidenceHeadings: [],
    pageNumbers: [1],
    rationale: "section",
    summary: "Summary.",
    title: "Procedure",
    topicType: "procedure",
    ...overrides,
  };
}
