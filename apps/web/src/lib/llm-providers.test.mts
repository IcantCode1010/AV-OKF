import assert from "node:assert/strict";
import test from "node:test";

import {
  getLlmProvider,
  isLlmProviderId,
  LLM_PROVIDERS,
} from "./llm-providers.ts";

test("LLM provider registry accepts only registered provider ids", () => {
  const providerIds = LLM_PROVIDERS.map((provider) => provider.id);

  assert.equal(providerIds.length, 2);
  for (const providerId of providerIds) {
    assert.equal(isLlmProviderId(providerId), true);
    assert.equal(getLlmProvider(providerId).id, providerId);
  }

  assert.equal(isLlmProviderId("grok"), false);
  assert.throws(() => getLlmProvider("grok"), /unsupported_llm_provider/);
});
