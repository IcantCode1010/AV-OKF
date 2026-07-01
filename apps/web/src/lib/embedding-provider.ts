import { createHash } from "node:crypto";

export type EmbeddingProvider = {
  dimensions: number;
  embedTexts(input: string[]): Promise<number[][]>;
  model: string;
};

export function getEmbeddingProvider(): EmbeddingProvider {
  if (process.env.AV_OKF_BACKEND === "production") {
    return createOpenAiEmbeddingProvider();
  }

  return createDeterministicEmbeddingProvider();
}

export function createDeterministicEmbeddingProvider(
  dimensions = 1536,
): EmbeddingProvider {
  return {
    dimensions,
    model: "deterministic-test-embedding",
    async embedTexts(input) {
      return input.map((text) => deterministicVector(text, dimensions));
    },
  };
}

export function createOpenAiEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("missing_env_OPENAI_API_KEY");
  }

  return {
    dimensions: 1536,
    model: "text-embedding-3-small",
    async embedTexts(input) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const response = await client.embeddings.create({
        encoding_format: "float",
        input,
        model: "text-embedding-3-small",
      });

      return response.data
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
    },
  };
}

function deterministicVector(text: string, dimensions: number) {
  const values: number[] = [];
  let counter = 0;

  while (values.length < dimensions) {
    const digest = createHash("sha256").update(`${text}:${counter}`).digest();

    for (const byte of digest) {
      values.push(byte / 127.5 - 1);

      if (values.length === dimensions) {
        break;
      }
    }

    counter += 1;
  }

  return normalize(values);
}

function normalize(values: number[]) {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );

  if (magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}
