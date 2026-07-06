import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChatAnswerPrompt,
  buildNotDirectlyAnsweredReply,
  generateChatAnswer,
  hasValidCitationMarkers,
} from "./chat-answer.ts";
import { buildRetrievalAnswer } from "./chat-retrieval.ts";
import type { ChatRetrievalEvidence } from "./chat-retrieval.ts";
import type { ChatCitation } from "./chat-types.ts";

function makeCitation(index: number): ChatCitation {
  return {
    documentTitle: "737NG QRH",
    index,
    pageEnd: 12,
    pageStart: 12,
    sourceType: "okf",
    text: "GEN OFF BUS light indicates a generator bus fault.",
  };
}

function makeEvidence(index: number): ChatRetrievalEvidence {
  return {
    documentTitle: "737NG QRH",
    index,
    pageEnd: 12,
    pageStart: 12,
    sourceType: "okf",
    text: "GEN OFF BUS light indicates a generator bus fault. Reset the generator per QRH 6.2.",
  };
}

const WORKSPACE_ID = "wrk_1";
const QUERY = "What does the GEN OFF BUS light indicate?";

const anthropicKey = async () =>
  ({ apiKey: "sk-test", provider: "anthropic" as const });

test("buildChatAnswerPrompt includes question, numbered evidence, and JSON contract", () => {
  const prompt = buildChatAnswerPrompt({
    evidence: [makeEvidence(1), { ...makeEvidence(2), sourceType: "rag" }],
    query: QUERY,
    route: "hybrid",
  });

  assert.match(prompt, /Question: What does the GEN OFF BUS light indicate\?/);
  assert.match(prompt, /\[1\] 737NG QRH \(page 12, approved knowledge\)/);
  assert.match(prompt, /\[2\] 737NG QRH \(page 12, raw document text\)/);
  assert.match(prompt, /"answer": string, "supported": boolean/);
  assert.match(prompt, /Do not use outside knowledge/);
});

test("buildChatAnswerPrompt frames downgraded discovery evidence as unreviewed", () => {
  const prompt = buildChatAnswerPrompt({
    evidence: [{ ...makeEvidence(1), sourceType: "rag" }],
    query: QUERY,
    ragDiscovery: true,
    route: "okf_only",
  });

  assert.match(prompt, /No approved knowledge matched/);
  assert.match(prompt, /never as official or approved guidance/);
  assert.doesNotMatch(prompt, /All evidence comes from the human-approved knowledge base/);
});

test("hasValidCitationMarkers accepts in-range markers and rejects missing or out-of-range ones", () => {
  assert.equal(hasValidCitationMarkers("Generator fault [1].", 2), true);
  assert.equal(hasValidCitationMarkers("Generator fault [1][2].", 2), true);
  assert.equal(hasValidCitationMarkers("Generator fault, trust me.", 2), false);
  assert.equal(hasValidCitationMarkers("Generator fault [3].", 2), false);
  assert.equal(hasValidCitationMarkers("Generator fault [0].", 2), false);
});

test("generateChatAnswer falls back to the deterministic answer when no workspace key exists", async () => {
  const retrieval = { citations: [makeCitation(1)], retrievalError: false };

  const answer = await generateChatAnswer(
    { evidence: [makeEvidence(1)], query: QUERY, retrieval, route: "okf_only", workspaceId: WORKSPACE_ID },
    {
      callProvider: async () => {
        throw new Error("provider_should_not_be_called");
      },
      getApiKey: async () => null,
    },
  );

  assert.equal(answer.mode, "deterministic");
  assert.equal(answer.content, buildRetrievalAnswer("okf_only", retrieval));
});

test("generateChatAnswer never calls the provider for empty or failed retrieval", async () => {
  let providerCalls = 0;
  const options = {
    callProvider: async () => {
      providerCalls += 1;
      return '{"answer": "x [1]", "supported": true}';
    },
    getApiKey: anthropicKey,
  };

  const emptyAnswer = await generateChatAnswer(
    {
      evidence: [],
      query: QUERY,
      retrieval: { citations: [], retrievalError: false },
      route: "okf_only",
      workspaceId: WORKSPACE_ID,
    },
    options,
  );
  const erroredAnswer = await generateChatAnswer(
    {
      evidence: [],
      query: QUERY,
      retrieval: { citations: [], retrievalError: true },
      route: "okf_only",
      workspaceId: WORKSPACE_ID,
    },
    options,
  );

  assert.equal(providerCalls, 0);
  assert.equal(emptyAnswer.mode, "deterministic");
  assert.match(emptyAnswer.content, /does not have a reviewed answer/i);
  assert.equal(erroredAnswer.mode, "deterministic");
  assert.match(erroredAnswer.content, /temporarily unavailable/i);
});

test("generateChatAnswer uses the LLM answer when it is supported and correctly cited", async () => {
  const answer = await generateChatAnswer(
    {
      evidence: [makeEvidence(1)],
      query: QUERY,
      retrieval: { citations: [makeCitation(1)], retrievalError: false },
      route: "okf_only",
      workspaceId: WORKSPACE_ID,
    },
    {
      callProvider: async () =>
        '{"answer": "The GEN OFF BUS light indicates a generator bus fault [1].", "supported": true}',
      getApiKey: anthropicKey,
    },
  );

  assert.equal(answer.mode, "llm");
  assert.equal(answer.provider, "anthropic");
  assert.ok(answer.model);
  assert.equal(
    answer.content,
    "The GEN OFF BUS light indicates a generator bus fault [1].",
  );
});

test("generateChatAnswer rejects answers citing evidence that does not exist", async () => {
  const retrieval = { citations: [makeCitation(1)], retrievalError: false };

  const answer = await generateChatAnswer(
    { evidence: [makeEvidence(1)], query: QUERY, retrieval, route: "okf_only", workspaceId: WORKSPACE_ID },
    {
      callProvider: async () =>
        '{"answer": "Generator bus fault [1], and also [4].", "supported": true}',
      getApiKey: anthropicKey,
    },
  );

  assert.equal(answer.mode, "deterministic");
  assert.equal(answer.content, buildRetrievalAnswer("okf_only", retrieval));
});

test("generateChatAnswer rejects uncited answers", async () => {
  const retrieval = { citations: [makeCitation(1)], retrievalError: false };

  const answer = await generateChatAnswer(
    { evidence: [makeEvidence(1)], query: QUERY, retrieval, route: "okf_only", workspaceId: WORKSPACE_ID },
    {
      callProvider: async () =>
        '{"answer": "It indicates a generator bus fault.", "supported": true}',
      getApiKey: anthropicKey,
    },
  );

  assert.equal(answer.mode, "deterministic");
});

test("generateChatAnswer reports not-directly-answered when the model says evidence is insufficient", async () => {
  const answer = await generateChatAnswer(
    {
      evidence: [makeEvidence(1)],
      query: QUERY,
      retrieval: { citations: [makeCitation(1)], retrievalError: false },
      route: "hybrid",
      workspaceId: WORKSPACE_ID,
    },
    {
      callProvider: async () => '{"answer": "", "supported": false}',
      getApiKey: anthropicKey,
    },
  );

  assert.equal(answer.mode, "llm");
  assert.equal(answer.content, buildNotDirectlyAnsweredReply("hybrid"));
});

test("generateChatAnswer falls back when the provider fails or returns malformed JSON", async () => {
  const retrieval = { citations: [makeCitation(1)], retrievalError: false };
  const base = {
    evidence: [makeEvidence(1)],
    query: QUERY,
    retrieval,
    route: "okf_only" as const,
    workspaceId: WORKSPACE_ID,
  };

  const failed = await generateChatAnswer(base, {
    callProvider: async () => {
      throw new Error("anthropic_request_failed:500");
    },
    getApiKey: anthropicKey,
  });
  const malformed = await generateChatAnswer(base, {
    callProvider: async () => "not json at all",
    getApiKey: anthropicKey,
  });
  const wrongShape = await generateChatAnswer(base, {
    callProvider: async () => '{"text": "missing the contract fields"}',
    getApiKey: anthropicKey,
  });

  assert.equal(failed.mode, "deterministic");
  assert.equal(malformed.mode, "deterministic");
  assert.equal(wrongShape.mode, "deterministic");
  assert.equal(failed.content, buildRetrievalAnswer("okf_only", retrieval));
});
