import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProviderId = "anthropic" | "kimi" | "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

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
    id: "kimi",
    label: "Moonshot AI (Kimi K3)",
    model: "kimi-k3",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    model: DEFAULT_OPENAI_MODEL,
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

  if (provider.id === "kimi") {
    return createOpenAI({
      apiKey,
      baseURL: "https://api.moonshot.ai/v1",
      name: "kimi",
    }).chat(provider.model);
  }

  return createOpenAI({ apiKey }).responses(provider.model);
}
