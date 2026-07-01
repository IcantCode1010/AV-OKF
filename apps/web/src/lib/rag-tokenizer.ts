import { getEncoding } from "js-tiktoken";

export type TokenCounter = {
  count(text: string): number;
  kind: "heuristic" | "tiktoken";
};

export function getTokenCounter(): TokenCounter {
  if (process.env.AV_OKF_BACKEND === "production") {
    return createTiktokenTokenCounter();
  }

  return createHeuristicTokenCounter();
}

export function createHeuristicTokenCounter(): TokenCounter {
  return {
    kind: "heuristic",
    count(text) {
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(1, Math.ceil(wordCount * 1.35));
    },
  };
}

export function createTiktokenTokenCounter(): TokenCounter {
  const encoding = getEncoding("cl100k_base");

  return {
    kind: "tiktoken",
    count(text) {
      return encoding.encode(text).length;
    },
  };
}
