import assert from "node:assert/strict";
import test from "node:test";

import {
  approveTopicContentSource,
  createOpenAiTopicEnrichmentProvider,
  createTopicEnrichmentProvider,
  enrichTopic,
  type TopicEnrichmentProvider,
  type TopicEnrichmentRepository,
} from "./topic-enrichment.ts";
import type {
  ExtractedPageRecord,
  TopicRecord,
} from "./document-vault.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";

type AuditRow = {
  errorMessage: string | null;
  model: string;
  promptSent: string;
  rawResponse: string;
  requestedBy: string;
  succeeded: boolean;
  topicId: string;
};

function baseTopic(overrides: Partial<TopicRecord> = {}): TopicRecord {
  return {
    approvedContentSource: null,
    confidence: "high",
    createdAt: "Jan 1, 2026, 12:00 PM",
    documentId: "doc_1",
    editedAt: null,
    editedBy: null,
    enrichedSummary: null,
    enrichedTitle: null,
    enrichmentErrorMessage: null,
    enrichmentModel: null,
    enrichmentStatus: "none",
    enrichedAt: null,
    id: "topic_1",
    originalSummary: "Original extracted summary",
    originalTitle: "Original extracted title",
    pageEnd: 2,
    pageStart: 1,
    relations: [],
    reviewStatus: "needs_review",
    sourcePageNumbers: [1, 2],
    summary: "Edited working summary",
    title: "Edited working title",
    topicType: "system_topic",
    updatedAt: "Jan 1, 2026, 12:00 PM",
    ...overrides,
  };
}

function page(pageNumber: number, text: string): ExtractedPageRecord {
  return {
    charCount: text.length,
    imageCount: 0,
    pageNumber,
    tables: [],
    text,
  };
}

function createFakeRepository(input: {
  sourcePages?: ExtractedPageRecord[];
  topic?: TopicRecord;
  workspaceId?: string;
} = {}) {
  const workspaceId = input.workspaceId ?? "wrk_1";
  let topic = input.topic ?? baseTopic();
  const audits: AuditRow[] = [];
  const completedProposals: number[][] = [];
  const sourcePages = input.sourcePages ?? [
    page(1, "Hydraulic system overview source text."),
    page(2, "Pump operation source text."),
  ];

  const repository: TopicEnrichmentRepository = {
    async approveTopicContent(input) {
      assertWorkspace(input.context);
      if (topic.reviewStatus === "approved") {
        throw new Error("topic_already_approved");
      }
      if (input.approvedContentSource === "enriched") {
        if (!topic.enrichedTitle || !topic.enrichedSummary) {
          throw new Error("topic_enrichment_required_for_approval");
        }
        topic = {
          ...topic,
          approvedContentSource: "enriched",
          reviewStatus: "approved",
          summary: topic.enrichedSummary,
          title: topic.enrichedTitle,
        };
      } else {
        topic = {
          ...topic,
          approvedContentSource: "raw",
          reviewStatus: "approved",
        };
      }
      return topic;
    },
    async failTopicEnrichment(input) {
      assertWorkspace(input.context);
      audits.push({
        errorMessage: input.errorMessage,
        model: input.model,
        promptSent: input.promptSent,
        rawResponse: input.rawResponse,
        requestedBy: input.requestedBy,
        succeeded: false,
        topicId: input.topicId,
      });
      topic = {
        ...topic,
        enrichmentErrorMessage: input.errorMessage,
        enrichmentStatus: "failed",
      };
      return topic;
    },
    async getTopicEnrichmentInput(input) {
      assertWorkspace(input.context);
      return {
        sourcePages,
        topic,
      };
    },
    async markTopicEnrichmentPending(input) {
      assertWorkspace(input.context);
      topic = {
        ...topic,
        enrichmentErrorMessage: null,
        enrichmentStatus: "pending",
      };
      return topic;
    },
    async completeTopicEnrichment(input) {
      assertWorkspace(input.context);
      audits.push({
        errorMessage: null,
        model: input.model,
        promptSent: input.promptSent,
        rawResponse: input.rawResponse,
        requestedBy: input.requestedBy,
        succeeded: true,
        topicId: input.topicId,
      });
      completedProposals.push(input.proposedSourcePageNumbers ?? []);
      topic = {
        ...topic,
        enrichedAt: "Jan 1, 2026, 12:01 PM",
        enrichedBody: input.enrichedBody ?? input.enrichedSummary,
        enrichedSummary: input.enrichedSummary,
        enrichedTitle: input.enrichedTitle,
        enrichmentErrorMessage: null,
        enrichmentModel: input.model,
        enrichmentStatus: "completed",
      };
      return topic;
    },
  };

  function assertWorkspace(context: AuthWorkspaceContext) {
    if (context.workspaceId !== workspaceId) {
      throw new Error("topic_enrichment_workspace_mismatch");
    }
  }

  return {
    audits,
    completedProposals,
    get topic() {
      return topic;
    },
    repository,
  };
}

function createProvider(
  providerId: string,
  implementation: TopicEnrichmentProvider["enrich"] = async () => ({
    rawResponse: JSON.stringify({
      summary: "Polished enriched summary",
      title: "Polished enriched title",
    }),
    summary: "Polished enriched summary",
    title: "Polished enriched title",
  }),
) {
  const calls: Parameters<TopicEnrichmentProvider["enrich"]>[0][] = [];
  const provider: TopicEnrichmentProvider = {
    model: `${providerId}-test`,
    provider: providerId,
    async enrich(input) {
      calls.push(input);
      return implementation(input);
    },
  };

  return { calls, provider };
}

const context: AuthWorkspaceContext = {
  role: "admin",
  userId: "usr_1",
  workspaceId: "wrk_1",
};

test("enrichment on approved topic is rejected before provider call", async () => {
  const { repository, audits } = createFakeRepository({
    topic: baseTopic({ reviewStatus: "approved" }),
  });
  const { calls, provider } = createProvider("anthropic");

  await assert.rejects(
    () =>
      enrichTopic("topic_1", {
        context,
        getApiKey: async () => "sk-ant-test",
        provider,
        repository,
      }),
    /topic_enrichment_requires_unapproved_topic/,
  );

  assert.equal(calls.length, 0);
  assert.equal(audits.length, 0);
});

test("missing API key prevents enrichment and audit creation", async () => {
  const { repository, audits } = createFakeRepository();
  const { calls, provider } = createProvider("anthropic");

  await assert.rejects(
    () =>
      enrichTopic("topic_1", {
        context,
        getApiKey: async () => null,
        provider,
        repository,
      }),
    /llm_enrichment_requires_api_key/,
  );

  assert.equal(calls.length, 0);
  assert.equal(audits.length, 0);
});

test("successful enrichment stores latest enriched values and success audit", async () => {
  const fake = createFakeRepository();
  const { provider } = createProvider("anthropic");

  const enriched = await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository: fake.repository,
  });

  assert.equal(enriched.enrichmentStatus, "completed");
  assert.equal(enriched.enrichedTitle, "Polished enriched title");
  assert.equal(enriched.enrichedSummary, "Polished enriched summary");
  assert.equal(fake.topic.enrichedTitle, "Polished enriched title");
  assert.equal(fake.audits.length, 1);
  assert.equal(fake.audits[0]?.succeeded, true);
  assert.match(fake.audits[0]?.promptSent ?? "", /Edited working title/);
  assert.match(
    fake.audits[0]?.promptSent ?? "",
    /Hydraulic system overview source text/,
  );
});

test("successful enrichment stores a framing-free article body", async () => {
  const fake = createFakeRepository();
  const { provider } = createProvider("anthropic", async () => ({
    body: "# Polished enriched title\n\n## Procedure\nPerform the check.\n\n## Source\nmanual.pdf, page 1",
    rawResponse: "response",
    summary: "Polished enriched summary",
    title: "Polished enriched title",
  }));

  const enriched = await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository: fake.repository,
  });

  assert.equal(enriched.enrichedBody, "## Procedure\nPerform the check.");
  assert.match(fake.audits[0]?.promptSent ?? "", /do not include a top-level H1/i);
  assert.match(fake.audits[0]?.promptSent ?? "", /do not restate the summary/i);
});

test("exact-page enrichment excludes nearby context and cannot propose new pages", async () => {
  const fake = createFakeRepository({
    sourcePages: [
      page(1, "Nearby page one."),
      page(2, "Established source page."),
      page(3, "Nearby page three."),
    ],
    topic: baseTopic({ pageEnd: 2, pageStart: 2, sourcePageNumbers: [2] }),
  });
  const { calls, provider } = createProvider("anthropic", async () => ({
    body: "Grounded article.",
    proposedSourcePageNumbers: [1, 2, 3],
    rawResponse: "response",
    summary: "Grounded summary.",
    title: "Grounded title",
  }));

  await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository: fake.repository,
    sourcePageMode: "exact",
  });

  assert.deepEqual(calls[0]?.sourcePages.map((sourcePage) => sourcePage.pageNumber), [2]);
  assert.match(calls[0]?.prompt ?? "", /return an empty proposedSourcePageNumbers array/i);
  assert.deepEqual(fake.completedProposals, [[]]);
});

test("failed enrichment stores failure audit and returns failed state", async () => {
  const { repository, audits } = createFakeRepository();
  const { provider } = createProvider("anthropic", async () => {
    throw new Error("anthropic_unavailable");
  });

  const failed = await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository,
  });

  assert.equal(failed.enrichmentStatus, "failed");
  assert.equal(failed.enrichedTitle, null);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.succeeded, false);
  assert.equal(audits[0]?.errorMessage, "anthropic_unavailable");
});

test("re-enrichment creates a second audit row and keeps latest success on topic", async () => {
  const { repository, audits } = createFakeRepository();
  let run = 0;
  const { provider } = createProvider("anthropic", async () => {
    run += 1;
    return {
      rawResponse: `response ${run}`,
      summary: `Summary ${run}`,
      title: `Title ${run}`,
    };
  });

  await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository,
  });
  const second = await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository,
  });

  assert.equal(audits.length, 2);
  assert.equal(audits[0]?.rawResponse, "response 1");
  assert.equal(audits[1]?.rawResponse, "response 2");
  assert.equal(second.enrichedTitle, "Title 2");
});

test("approval can choose enriched or raw content explicitly", async () => {
  const enrichedRepo = createFakeRepository({
    topic: baseTopic({
      enrichedSummary: "Enriched approved summary",
      enrichedTitle: "Enriched approved title",
      enrichmentStatus: "completed",
    }),
  });
  const rawRepo = createFakeRepository({
    topic: baseTopic({
      enrichedSummary: "Enriched approved summary",
      enrichedTitle: "Enriched approved title",
      enrichmentStatus: "completed",
      summary: "Human edited summary",
      title: "Human edited title",
    }),
  });

  const enriched = await approveTopicContentSource("topic_1", "enriched", {
    context,
    repository: enrichedRepo.repository,
  });
  const raw = await approveTopicContentSource("topic_1", "raw", {
    context,
    repository: rawRepo.repository,
  });

  assert.equal(enriched.reviewStatus, "approved");
  assert.equal(enriched.approvedContentSource, "enriched");
  assert.equal(enriched.title, "Enriched approved title");
  assert.equal(enriched.summary, "Enriched approved summary");
  assert.equal(raw.approvedContentSource, "raw");
  assert.equal(raw.title, "Human edited title");
  assert.equal(raw.summary, "Human edited summary");
});

test("cross-workspace enrichment trigger is rejected", async () => {
  const { repository } = createFakeRepository({ workspaceId: "wrk_other" });
  const { calls, provider } = createProvider("anthropic");

  await assert.rejects(
    () =>
      enrichTopic("topic_1", {
        context,
        getApiKey: async () => "sk-ant-test",
        provider,
        repository,
      }),
    /topic_enrichment_workspace_mismatch/,
  );

  assert.equal(calls.length, 0);
});

test("provider receives current edited title and summary, not original extraction", async () => {
  const { repository } = createFakeRepository({
    topic: baseTopic({
      originalSummary: "Original summary must not drive enrichment",
      originalTitle: "Original title must not drive enrichment",
      summary: "Reviewer corrected summary",
      title: "Reviewer corrected title",
    }),
  });
  const { calls, provider } = createProvider("anthropic");

  await enrichTopic("topic_1", {
    context,
    getApiKey: async () => "sk-ant-test",
    provider,
    repository,
  });

  assert.equal(calls[0]?.title, "Reviewer corrected title");
  assert.equal(calls[0]?.summary, "Reviewer corrected summary");
  assert.notEqual(calls[0]?.title, "Original title must not drive enrichment");
  assert.notEqual(calls[0]?.summary, "Original summary must not drive enrichment");
});

test("workspace OpenAI setting selects the OpenAI provider implementation", async () => {
  const { repository } = createFakeRepository();
  const anthropic = createProvider("anthropic");
  const openai = createProvider("openai");

  await enrichTopic("topic_1", {
    context,
    getApiKey: async () => ({ apiKey: "sk-openai", provider: "openai" }),
    providerFactory: (providerId) =>
      providerId === "openai" ? openai.provider : anthropic.provider,
    repository,
  });

  assert.equal(openai.calls.length, 1);
  assert.equal(anthropic.calls.length, 0);
});

test("workspace Anthropic setting still selects the Anthropic provider implementation", async () => {
  const { repository } = createFakeRepository();
  const anthropic = createProvider("anthropic");
  const openai = createProvider("openai");

  await enrichTopic("topic_1", {
    context,
    getApiKey: async () => ({ apiKey: "sk-ant", provider: "anthropic" }),
    providerFactory: (providerId) =>
      providerId === "openai" ? openai.provider : anthropic.provider,
    repository,
  });

  assert.equal(anthropic.calls.length, 1);
  assert.equal(openai.calls.length, 0);
});

test("OpenAI provider reports malformed JSON fields like Anthropic", async () => {
  const provider = createOpenAiTopicEnrichmentProvider(async () => ({
    title: "Only title",
  }));

  await assert.rejects(
    () =>
      provider.enrich({
        apiKey: "sk-openai",
        prompt: "prompt",
        sourcePages: [],
        summary: "summary",
        title: "title",
      }),
    /llm_enrichment_malformed_response/,
  );
});

test("provider factory returns registered implementations", () => {
  assert.equal(createTopicEnrichmentProvider("anthropic").provider, "anthropic");
  assert.equal(createTopicEnrichmentProvider("openai").provider, "openai");
});
