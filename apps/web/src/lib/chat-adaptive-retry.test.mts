import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedAdaptiveRetryQuery } from "./chat-adaptive-retry.ts";
import type { ChatRouterDecision } from "./chat-router.ts";

const decision: ChatRouterDecision = {
  confidence: "high",
  constraints: { approvedOnly: true, includeUnreviewed: false },
  queryCategory: "policy_or_process",
  rationale: "test",
  requiredContext: [],
  route: "okf_only",
};

const weak = {
  reason: "approved_knowledge_did_not_cover_the_question",
  status: "weak" as const,
};

test("disabled bundles never call the provider", async () => {
  let called = false;
  const result = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: [],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        called = true;
        return {};
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.trace.outcome, "disabled");
});

test("one structured retry preserves route and protected identifiers", async () => {
  const result = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official GEN OFF BUS procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return {
          expansionTerms: ["operational guidance"],
          reason: "Use the full operational phrase.",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );
  assert.equal(result.query, "official GEN OFF BUS procedure operational guidance");
  assert.equal(result.trace.outcome, "applied");
  assert.deepEqual(result.trace.enabledBundleIds, ["kb_1"]);
});

test("provider usage is persisted without changing structured output parsing", async () => {
  const result = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return {
          output: {
            expansionTerms: ["approved operational guidance"],
            reason: "Use the approved terminology.",
          },
          usage: {
            inputTokens: 120,
            outputTokens: 24,
            totalTokens: 144,
          },
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );

  assert.equal(result.trace.outcome, "applied");
  assert.deepEqual(result.trace.usage, {
    inputTokens: 120,
    outputTokens: 24,
    totalTokens: 144,
  });
});

test("route-changing expansions fail closed and protected identifiers remain structural", async () => {
  const ragDecision: ChatRouterDecision = {
    confidence: "high",
    constraints: { approvedOnly: false, includeUnreviewed: true },
    queryCategory: "open_ended_discovery",
    rationale: "test",
    requiredContext: [],
    route: "rag_only",
  };
  const routeChange = await createBoundedAdaptiveRetryQuery(
    {
      decision: ragDecision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "search forklift documents",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return {
          expansionTerms: ["official policy"],
          reason: "Change discovery into approved plus document retrieval.",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );
  assert.equal(routeChange.query, undefined);
  assert.equal(routeChange.trace.outcome, "rejected_route_change");

  const identifierPreserved = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official GEN OFF BUS procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return {
          expansionTerms: ["electrical isolation guidance"],
          reason: "Remove the identifier.",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );
  assert.equal(
    identifierPreserved.query,
    "official GEN OFF BUS procedure electrical isolation guidance",
  );
  assert.equal(identifierPreserved.trace.outcome, "applied");
  assert.match(identifierPreserved.query ?? "", /GEN OFF BUS/);
});

test("prompt requests canonical expansion terms instead of a rewritten question", async () => {
  let prompt = "";
  const result = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "According to authoritative knowledge, how is a supplier bill checked?",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider(input) {
        prompt = input.prompt;
        return {
          expansionTerms: ["invoice reconciliation", "purchase order receipt"],
          reason: "Use canonical accounting terminology.",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );

  assert.match(prompt, /appends your expansionTerms/);
  assert.match(prompt, /not a rewritten question/);
  assert.equal(
    result.query,
    "According to authoritative knowledge, how is a supplier bill checked? invoice reconciliation purchase order receipt",
  );
  assert.equal(result.trace.outcome, "applied");
});

test("duplicate-only expansions are rejected as equivalent", async () => {
  const result = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return {
          expansionTerms: ["brake procedure", "official"],
          reason: "Repeat the same terms.",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );

  assert.equal(result.query, undefined);
  assert.equal(result.trace.outcome, "rejected_equivalent_query");
});

test("provider and key failures preserve deterministic fallback", async () => {
  const missingKey = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    { async getApiKey() { return null; } },
  );
  assert.equal(missingKey.trace.outcome, "missing_key");
  assert.equal(missingKey.trace.fallbackUsed, true);

  const providerFailure = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        throw new Error("offline");
      },
      async getApiKey() {
        return { apiKey: "test", provider: "anthropic" };
      },
    },
  );
  assert.equal(providerFailure.trace.outcome, "provider_failed");
  assert.equal(providerFailure.trace.fallbackUsed, true);
});

test("malformed provider output is traced separately and fails open", async () => {
  const malformed = await createBoundedAdaptiveRetryQuery(
    {
      decision,
      enabledBundleIds: ["kb_1"],
      originalQuery: "official brake procedure",
      sufficiency: weak,
      workspaceId: "wrk_1",
    },
    {
      async callProvider() {
        return { expansionTerms: [], reason: "" };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );

  assert.equal(malformed.query, undefined);
  assert.equal(malformed.trace.outcome, "malformed_response");
  assert.equal(malformed.trace.fallbackUsed, true);
});
