import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProviderId = "anthropic" | "openai";

export const LLM_PROVIDERS: {
  id: LlmProviderId;
  label: string;
  model: string;
}[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    model: "claude-3-5-haiku-20241022",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    model: "gpt-4o-mini",
  },
];

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDERS.some((provider) => provider.id === value);
}

export function getLlmProvider(id: string) {
  const provider = LLM_PROVIDERS.find((candidate) => candidate.id === id);

  if (!provider) {
    throw new Error("unsupported_llm_provider");
  }

  return provider;
}

export function getSdkModel(
  providerId: LlmProviderId,
  apiKey: string,
): LanguageModel {
  const provider = getLlmProvider(providerId);

  if (provider.id === "anthropic") {
    return createAnthropic({ apiKey }).languageModel(provider.model);
  }

  return createOpenAI({ apiKey }).chat(provider.model);
}
