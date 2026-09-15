import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageWindows,
  CONSOLIDATION_INPUT_TOKEN_BUDGET,
  CONSOLIDATION_SAFE_OUTPUT_TOKEN_BUDGET,
  discoverDocumentTopics,
  estimateTokens,
  getTopicDiscoveryMaxOutputTokens,
  isAdministrativeTopicTitle,
  resolveExplicitTopicContinuations,
  validateDiscoveredTopics,
  normalizeDiscoveredTopicType,
  type TopicDiscoveryProvider,
} from "./topic-discovery.ts";

test("topic type normalization maps model variants into the active profile vocabulary", () => {
  const allowed = ["concept", "procedure", "system"];
  assert.equal(normalizeDiscoveredTopicType("Operational Procedure", allowed), "procedure");
  assert.equal(normalizeDiscoveredTopicType("System Overview", allowed), "system");
  assert.equal(normalizeDiscoveredTopicType("Unexpected Type", allowed), "concept");
});

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

test("validation excludes administrative sections but preserves operational revision topics", () => {
  assert.equal(isAdministrativeTopicTitle("Effective Pages List"), true);
  assert.equal(isAdministrativeTopicTitle("Manual Revision History"), true);
  assert.equal(isAdministrativeTopicTitle("Software Revision Procedure"), false);
  const topics = validateDiscoveredTopics([
    topic({ pageNumbers: [1], title: "Effective Pages List" }),
    topic({ pageNumbers: [2], title: "Manual Revision History" }),
    topic({ pageNumbers: [3], title: "Software Revision Procedure" }),
  ], [page(1, "a"), page(2, "b"), page(3, "c")]);
  assert.deepEqual(topics.map((entry) => entry.title), ["Software Revision Procedure"]);
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

test("oversized consolidation uses bounded intermediate reductions", async () => {
  const consolidationPrompts: string[] = [];
  let windowOrdinal = 0;
  const provider: TopicDiscoveryProvider = {
    model: "mock-model",
    provider: "openai",
    async discover(input) {
      if (input.stage === "window") {
        windowOrdinal += 1;
        const topics = [{
          confidence: "high" as const,
          evidenceHeadings: [`SECTION ${windowOrdinal}`],
          pageNumbers: [windowOrdinal],
          rationale: "Grounded section heading.",
          summary: `Detailed grounded summary ${"content ".repeat(5_000)}`,
          title: `Operational Section ${windowOrdinal}`,
          topicType: "system",
        }];
        return { output: { topics }, rawResponse: JSON.stringify({ topics }) };
      }

      consolidationPrompts.push(input.prompt);
      const topics = [{
        confidence: "high" as const,
        evidenceHeadings: ["SYSTEM"],
        pageNumbers: [1],
        rationale: "Consolidated from grounded candidates.",
        summary: "A supported system topic.",
        title: `Consolidated System ${consolidationPrompts.length}`,
        topicType: "system",
      }];
      return { output: { topics }, rawResponse: JSON.stringify({ topics }) };
    },
  };

  const pages = Array.from({ length: 10 }, (_, index) =>
    page(index + 1, `SECTION ${index + 1}\nOperational details`)
  );
  const result = await discoverDocumentTopics({
    documentTitle: "Large Manual",
    pages,
    provider,
    tokenTarget: 1,
  });

  assert.ok(consolidationPrompts.length >= 3);
  assert.ok(consolidationPrompts.some((prompt) => prompt.includes("Intermediate consolidation")));
  assert.ok(consolidationPrompts.every(
    (prompt) => estimateTokens(prompt) <= CONSOLIDATION_INPUT_TOKEN_BUDGET,
  ));
  assert.equal(result.topics.length, 1);
});

test("durable window results avoid repeating provider window calls", async () => {
  let windowCalls = 0;
  const cachedTopic = topic({ pageNumbers: [1], title: "Cached Brake System" });
  const provider: TopicDiscoveryProvider = {
    model: "mock-model",
    provider: "openai",
    async discover(input) {
      if (input.stage === "window") windowCalls += 1;
      const topics = input.stage === "window"
        ? [cachedTopic]
        : [topic({ pageNumbers: [1], title: "Consolidated Brake System" })];
      return { output: { topics }, rawResponse: JSON.stringify({ topics }) };
    },
  };

  await discoverDocumentTopics({
    documentTitle: "Manual",
    loadWindowResult: async () => ({ topics: [cachedTopic] }),
    pages: [page(1, "BRAKES\nOperation")],
    provider,
  });

  assert.equal(windowCalls, 0);
});

test("durable consolidation results avoid repeating successful provider reductions", async () => {
  let providerCalls = 0;
  const cachedWindowTopic = topic({ pageNumbers: [1], title: "Cached Brake System" });
  const cachedConsolidatedTopic = topic({ pageNumbers: [1], title: "Consolidated Brake System" });
  const provider: TopicDiscoveryProvider = {
    model: "mock-model",
    provider: "openai",
    async discover() {
      providerCalls += 1;
      throw new Error("provider_should_not_be_called");
    },
  };

  const result = await discoverDocumentTopics({
    documentTitle: "Manual",
    loadConsolidationResult: async () => ({ topics: [cachedConsolidatedTopic] }),
    loadWindowResult: async () => ({ topics: [cachedWindowTopic] }),
    pages: [page(1, "BRAKES\nOperation")],
    provider,
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.topics[0]!.title, "Consolidated Brake System");
});

test("large flat results do not require an impossible final structured response", async () => {
  const initialTopics = Array.from({ length: 40 }, (_, index) => topic({
    pageNumbers: [1],
    summary: `Initial source detail ${index} ${"content ".repeat(1_300)}`,
    title: `Initial System ${index}`,
  }));
  const reducedTopics = Array.from({ length: 150 }, (_, index) => topic({
    evidenceHeadings: [`System ${index}`],
    pageNumbers: [1],
    rationale: "Consolidated from the supplied grounded section candidate.",
    summary: `Supported system description ${index} ${"detail ".repeat(30)}`,
    title: `Reduced System ${index}`,
  }));
  assert.ok(
    estimateTokens(JSON.stringify({ topics: reducedTopics })) >
      CONSOLIDATION_SAFE_OUTPUT_TOKEN_BUDGET,
  );
  const consolidationPrompts: string[] = [];
  const provider: TopicDiscoveryProvider = {
    model: "mock-model",
    provider: "openai",
    async discover(input) {
      assert.equal(input.stage, "consolidation");
      consolidationPrompts.push(input.prompt);
      return {
        output: { topics: reducedTopics },
        rawResponse: JSON.stringify({ topics: reducedTopics }),
      };
    },
  };

  const result = await discoverDocumentTopics({
    documentTitle: "Large Manual",
    loadWindowResult: async () => ({ topics: initialTopics }),
    pages: [page(1, "SYSTEMS\nOperational details")],
    provider,
  });

  assert.ok(consolidationPrompts.length >= 2);
  assert.ok(consolidationPrompts.every((prompt) => prompt.includes("Intermediate consolidation")));
  assert.equal(result.topics.length, reducedTopics.length);
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
