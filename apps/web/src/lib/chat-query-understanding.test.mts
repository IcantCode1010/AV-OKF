import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldRunQueryUnderstanding,
  understandChatQuery,
} from "./chat-query-understanding.ts";
import { routeChatQuestion } from "./chat-router.ts";

function providerOutput(overrides: Record<string, unknown> = {}) {
  return {
    ambiguityLevel: "medium",
    assumptions: [],
    clarifyingQuestion: null,
    detectedEntities: [],
    retrievalQuery: "policy search",
    ...overrides,
  };
}

test("high-confidence precise questions skip LLM query understanding", async () => {
  const question = "What is the official source for Policy POL-SEC-104?";
  const decision = routeChatQuestion(question);
  assert.equal(shouldRunQueryUnderstanding({ decision, question }), false);

  let providerCalls = 0;
  const result = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () => {
        providerCalls += 1;
        throw new Error("provider_should_not_run");
      },
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.rewriteMode, "not_needed");
  assert.equal(result.retrievalQuery, result.originalQuestion);
  assert.deepEqual(result.assumptions, []);
});

test("ambiguous questions are rewritten while preserving mixed-domain identifiers", async () => {
  const question = "What is POL-SEC-104?";
  const decision = { ...routeChatQuestion(question), routerMode: "llm_fallback" as const };
  const result = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () =>
        providerOutput({
          detectedEntities: ["POL-SEC-104"],
          retrievalQuery: "POL-SEC-104 approved exception policy",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "llm");
  assert.equal(result.retrievalQuery, "POL-SEC-104 approved exception policy");
  assert.deepEqual(result.detectedEntities, ["POL-SEC-104"]);
});

test("a rewrite that drops a protected citation falls back to the original", async () => {
  const question = "Review GDPR Article 46";
  const decision = { ...routeChatQuestion(question), routerMode: "llm_fallback" as const };
  const result = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () =>
        providerOutput({ retrievalQuery: "review transfer requirements" }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "fallback_original");
  assert.equal(result.retrievalQuery, question);
  assert.deepEqual(result.warnings, ["query_understanding_dropped_protected_entity"]);
});

test("protected entity preservation uses token boundaries", async () => {
  const question = "Explain SOC";
  const decision = { ...routeChatQuestion(question), routerMode: "llm_fallback" as const };
  const result = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () =>
        providerOutput({
          detectedEntities: ["SOC"],
          retrievalQuery: "Explain SOCIAL controls",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "fallback_original");
  assert.deepEqual(result.warnings, ["query_understanding_dropped_protected_entity"]);
});

test("route-changing rewrites are discarded and logged", async () => {
  const question = "What is Policy POL-SEC-104?";
  const decision = { ...routeChatQuestion(question), routerMode: "llm_fallback" as const };
  const result = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () =>
        providerOutput({
          detectedEntities: ["Policy POL-SEC-104"],
          retrievalQuery: "Find all documents that mention Policy POL-SEC-104",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(decision.route, "okf_only");
  assert.equal(result.rewriteMode, "fallback_original");
  assert.equal(result.retrievalQuery, question);
  assert.equal(result.routeConflict?.optimizedRoute, "rag_only");
  assert.deepEqual(result.warnings, ["optimized_query_route_conflict"]);
});

test("a complete clarification follow-up proceeds without assumptions", async () => {
  const question = "It is Policy POL-SEC-104 version 2 for employee access.";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });
  const result = await understandChatQuery(
    {
      clarificationAlreadyAsked: true,
      clarificationOriginQuestion: "Can we approve this access change?",
      decision,
      question,
      workspaceId: "wrk_1",
    },
    {
      callProvider: async () =>
        providerOutput({
          ambiguityLevel: "low",
          detectedEntities: ["Policy POL-SEC-104"],
          retrievalQuery: "Policy POL-SEC-104 version 2 employee access approval",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "llm");
  assert.deepEqual(result.assumptions, []);
  assert.match(result.retrievalQuery, /POL-SEC-104/);
});

test("an incomplete clarification follow-up uses bounded disclosed assumptions", async () => {
  const question = "Use version 2.";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });
  const result = await understandChatQuery(
    {
      clarificationAlreadyAsked: true,
      clarificationOriginQuestion: "Can we approve this policy?",
      decision,
      question,
      workspaceId: "wrk_1",
    },
    {
      callProvider: async () =>
        providerOutput({
          assumptions: [
            {
              basis: "conversation",
              field: "subject_or_entity",
              value: "this policy",
            },
            {
              basis: "safe_default",
              field: "source_authority",
              value: "approved OKF first, with raw documents only as labeled discovery",
            },
          ],
          retrievalQuery: "policy approval version 2",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "llm");
  assert.match(result.retrievalQuery, /this policy/);
  assert.doesNotMatch(result.retrievalQuery, /raw documents only/);
  assert.equal(result.assumptions.length, 2);
});

test("invalid assumptions fail safely to the fixed default set", async () => {
  const question = "Use it.";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });
  const result = await understandChatQuery(
    {
      clarificationAlreadyAsked: true,
      clarificationOriginQuestion: "Can we approve this?",
      decision,
      question,
      workspaceId: "wrk_1",
    },
    {
      callProvider: async () =>
        providerOutput({
          assumptions: [
            {
              basis: "safe_default",
              field: "subject_or_entity",
              value: "an invented customer account",
            },
          ],
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.equal(result.rewriteMode, "fallback_original");
  assert.equal(result.assumptions.length, 4);
  assert.deepEqual(result.warnings, ["query_understanding_invalid_assumptions"]);
});

test("missing key and malformed provider output fail safely", async () => {
  const question = "Can we approve this?";
  const decision = routeChatQuestion(question);
  const withoutKey = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    { getApiKey: async () => null },
  );

  assert.equal(withoutKey.rewriteMode, "fallback_original");
  assert.deepEqual(withoutKey.assumptions, []);

  const malformed = await understandChatQuery(
    { decision, question, workspaceId: "wrk_1" },
    {
      callProvider: async () => ({ retrievalQuery: "" }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "anthropic" }),
    },
  );

  assert.equal(malformed.rewriteMode, "fallback_original");
  assert.deepEqual(malformed.warnings, ["query_understanding_malformed_response"]);
});

test("an immediate clarification response enables query understanding", () => {
  const question = "Version 2.";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });

  assert.equal(
    shouldRunQueryUnderstanding({
      clarificationAlreadyAsked: true,
      clarificationOriginQuestion: "Can we approve this policy?",
      decision,
      question,
    }),
    true,
  );
});

test("a prior clarification does not optimize every later clear question", () => {
  const question = "What does ground leveling mean in the forklift manual?";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });

  assert.equal(
    shouldRunQueryUnderstanding({
      clarificationAlreadyAsked: true,
      decision,
      question,
    }),
    false,
  );
});

test("empty required context never expands into every safe default", async () => {
  const question = "What does ground leveling mean in this forklift manual?";
  const decision = routeChatQuestion({ clarificationAlreadyAsked: true, question });
  const result = await understandChatQuery(
    {
      clarificationAlreadyAsked: true,
      decision,
      question,
      workspaceId: "wrk_1",
    },
    {
      callProvider: async () =>
        providerOutput({
          assumptions: [
            {
              basis: "safe_default",
              field: "source_authority",
              value: "approved OKF first, with raw documents only as labeled discovery",
            },
          ],
          retrievalQuery: "ground leveling forklift manual",
        }),
      getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
    },
  );

  assert.deepEqual(result.assumptions, []);
});
