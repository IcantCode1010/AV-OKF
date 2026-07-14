import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStage6aRouterReply,
  classifyChatRouteWithLlm,
  routeChatQuestion,
  routeChatQuestionWithFallback,
} from "./chat-router.ts";

test("routes official manual path questions to OKF", () => {
  const decision = routeChatQuestion(
    "What is the official manual path for REVERSER UNLOCKED IN FLIGHT?",
  );

  assert.equal(decision.route, "okf_only");
  assert.equal(decision.queryCategory, "source_lookup");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.constraints.approvedOnly, true);
  assert.equal(decision.constraints.includeUnreviewed, false);
});

test("routes broad document mention searches to RAG", () => {
  const decision = routeChatQuestion(
    "Find all documents that mention ELT battery replacement.",
  );

  assert.equal(decision.route, "rag_only");
  assert.equal(decision.queryCategory, "open_ended_discovery");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.constraints.approvedOnly, false);
  assert.equal(decision.constraints.includeUnreviewed, true);
});

test("routes official answers plus examples to hybrid", () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );

  assert.equal(decision.route, "hybrid");
  assert.equal(decision.queryCategory, "comparison");
  assert.equal(decision.confidence, "medium");
});

test("routes vague dispatch questions to missing context", () => {
  const decision = routeChatQuestion("Can we dispatch?");

  assert.equal(decision.route, "missing_context");
  assert.equal(decision.queryCategory, "missing_context");
  assert.deepEqual(decision.requiredContext, [
    "aircraft_family",
    "effectivity",
    "source_authority",
    "operational_context",
  ]);
});

test("routes live data requests to unsupported", () => {
  const decision = routeChatQuestion("What is today's inventory count?");

  assert.equal(decision.route, "unsupported");
  assert.equal(decision.queryCategory, "live_or_fresh_data");
  assert.equal(decision.confidence, "high");
});

test("routes current official policy questions to approved OKF", () => {
  const decision = routeChatQuestion("What is the current official policy?");

  assert.equal(decision.route, "okf_only");
  assert.equal(decision.queryCategory, "policy_or_process");
  assert.equal(decision.confidence, "high");
});

test("marks high-risk operational questions for reviewed OKF handling", () => {
  const decision = routeChatQuestion("What is the procedure for an engine fire in flight?");

  assert.equal(decision.route, "okf_only");
  assert.equal(decision.queryCategory, "high_risk_domain");
  assert.equal(decision.confidence, "medium");
});

test("routes plain interrogative questions to OKF at medium confidence", () => {
  for (const question of [
    "what is DC generation",
    "How does the flap skew detection system work?",
    "Explain the thrust reverser control system",
    "where are the flap skew sensors",
  ]) {
    const decision = routeChatQuestion(question);

    assert.equal(decision.route, "okf_only", question);
    assert.equal(decision.confidence, "medium", question);
    assert.equal(decision.constraints.approvedOnly, true, question);
  }
});

test("accepts the structured router input object and routes on its question", () => {
  const decision = routeChatQuestion({
    conversationContext: ["user: hi", "assistant: hello"],
    question: "what is DC generation",
    workspaceId: "wrk_1",
  });

  assert.equal(decision.route, "okf_only");
  assert.deepEqual(decision, routeChatQuestion("what is DC generation"));
});

test("explicit keyword questions still outrank the interrogative heuristic", () => {
  const decision = routeChatQuestion("What is the definition of DC generation?");

  assert.equal(decision.route, "okf_only");
  assert.equal(decision.confidence, "high");
});

test("buildStage6aRouterReply asks for missing context instead of implying retrieval", () => {
  const decision = routeChatQuestion("What procedure should I use?");
  const reply = buildStage6aRouterReply(decision);

  assert.match(reply, /need a little more context/i);
  assert.match(reply, /aircraft family/i);
  assert.doesNotMatch(reply, /retrieval will be added/i);
});

test("router fallback classifies only low-confidence rule results", async () => {
  let fallbackCalls = 0;

  const highConfidence = await routeChatQuestionWithFallback(
    { question: "What is today's inventory count?", workspaceId: "wrk_1" },
    {
      classifyWithLlm: async () => {
        fallbackCalls += 1;
        throw new Error("fallback_should_not_run");
      },
    },
  );

  assert.equal(highConfidence.route, "unsupported");
  assert.equal(highConfidence.routerMode, "rules");
  assert.equal(fallbackCalls, 0);

  const lowConfidence = await routeChatQuestionWithFallback(
    { question: "generator bus reset", workspaceId: "wrk_1" },
    {
      classifyWithLlm: async () => {
        fallbackCalls += 1;
        return {
          confidence: "medium",
          constraints: { approvedOnly: false, includeUnreviewed: true },
          queryCategory: "open_ended_discovery",
          rationale: "The user is searching for matching source content.",
          requiredContext: [],
          route: "rag_only",
        };
      },
    },
  );

  assert.equal(lowConfidence.route, "rag_only");
  assert.equal(lowConfidence.routerMode, "llm_fallback");
  assert.equal(fallbackCalls, 1);
});

test("router fallback keeps the conservative rule result when no workspace key exists", async () => {
  let providerCalls = 0;

  const decision = await routeChatQuestionWithFallback(
    { question: "generator bus reset", workspaceId: "wrk_1" },
    {
      classifyWithLlm: (input) =>
        classifyChatRouteWithLlm(input, {
          callProvider: async () => {
            providerCalls += 1;
            return "{}";
          },
          getApiKey: async () => null,
        }),
    },
  );

  assert.equal(decision.route, "missing_context");
  assert.equal(decision.routerMode, "rules");
  assert.equal(providerCalls, 0);
});

test("router fallback consumes structured provider output and rejects invalid shapes", async () => {
  const rulesDecision = routeChatQuestion("generator bus reset");
  let prompt = "";

  const classified = await classifyChatRouteWithLlm(
    {
      question: "generator bus reset",
      rulesDecision,
      workspaceId: "wrk_1",
    },
    {
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
      callProvider: async (input) => {
        prompt = input.prompt;
        return {
          confidence: "medium",
          queryCategory: "open_ended_discovery",
          rationale: "The user is searching indexed documents.",
          requiredContext: [],
          route: "rag_only",
        };
      },
    },
  );

  assert.equal(classified?.route, "rag_only");
  assert.match(prompt, /generator bus reset/);
  assert.doesNotMatch(prompt, /sk-test/);

  const malformed = await classifyChatRouteWithLlm(
    {
      question: "generator bus reset",
      rulesDecision,
      workspaceId: "wrk_1",
    },
    {
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
      callProvider: async () => ({ route: "not_a_route" }),
    },
  );

  assert.equal(malformed, null);
});
