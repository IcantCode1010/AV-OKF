import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OPENAI_MODEL,
  getLlmProvider,
  getSdkModel,
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

test("OpenAI uses GPT-5.6 Terra through the Responses API", () => {
  const provider = getLlmProvider("openai");
  const model = getSdkModel("openai", "test-api-key");

  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.6-terra");
  assert.equal(provider.model, DEFAULT_OPENAI_MODEL);
  assert.equal(model.modelId, DEFAULT_OPENAI_MODEL);
  assert.equal(model.provider, "openai.responses");
});
