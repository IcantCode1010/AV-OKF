import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageWindows,
  discoverDocumentTopics,
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
