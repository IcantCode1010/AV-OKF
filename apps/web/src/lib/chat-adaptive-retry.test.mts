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
          reason: "Use the full operational phrase.",
          retryQuery: "official GEN OFF BUS procedure operational guidance",
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

test("route changes and protected identifier loss fail closed", async () => {
  const routeChange = await createBoundedAdaptiveRetryQuery(
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
          reason: "Broaden externally.",
          retryQuery: "latest live weather status",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );
  assert.equal(routeChange.query, undefined);
  assert.equal(routeChange.trace.outcome, "rejected_route_change");

  const identifierLoss = await createBoundedAdaptiveRetryQuery(
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
          reason: "Remove the identifier.",
          retryQuery: "official electrical procedure guidance",
        };
      },
      async getApiKey() {
        return { apiKey: "test", provider: "openai" };
      },
    },
  );
  assert.equal(identifierLoss.query, undefined);
  assert.equal(identifierLoss.trace.outcome, "rejected_identifier_loss");
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
        return { retryQuery: "", reason: "" };
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
