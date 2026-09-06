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

  assert.equal(providerIds.length, 3);
  for (const providerId of providerIds) {
    assert.equal(isLlmProviderId(providerId), true);
    assert.equal(getLlmProvider(providerId).id, providerId);
  }

  assert.equal(isLlmProviderId("grok"), false);
  assert.throws(() => getLlmProvider("grok"), /unsupported_llm_provider/);
});

test("Kimi K3 uses Moonshot's OpenAI-compatible chat endpoint", () => {
  const provider = getLlmProvider("kimi");
  const model = getSdkModel("kimi", "test-api-key") as unknown as {
    modelId: string;
    provider: string;
  };

  assert.equal(provider.model, "kimi-k3");
  assert.equal(model.modelId, "kimi-k3");
  assert.equal(model.provider, "kimi.chat");
});

test("OpenAI uses GPT-5.6 Terra through the Responses API", () => {
  const provider = getLlmProvider("openai");
  const model = getSdkModel("openai", "test-api-key") as unknown as {
    modelId: string;
    provider: string;
  };

  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.6-terra");
  assert.equal(provider.model, DEFAULT_OPENAI_MODEL);
  assert.equal(model.modelId, DEFAULT_OPENAI_MODEL);
  assert.equal(model.provider, "openai.responses");
});
