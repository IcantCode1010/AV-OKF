import { Output, generateText } from "ai";
import { z } from "zod";

import { getSdkModel, type LlmProviderId } from "./llm-providers.ts";
import { getPrisma } from "./prisma.ts";

const CONSOLIDATION_INPUT_BUDGET = 80_000;
const INTERMEDIATE_INPUT_BUDGET = 60_000;

const consolidatedSchema = z.object({
  topics: z.array(z.object({
    confidence: z.enum(["low", "medium", "high"]),
    sourcePages: z.array(z.number().int().positive()).min(1),
    sourceTopicIds: z.array(z.string()).min(1),
    summary: z.string().min(1),
    title: z.string().min(1),
    topicType: z.string().min(1),
  })),
});

type ConsolidationTopic = {
  confidence: string;
  id: string;
  sourcePages: number[];
  summary: string;
  title: string;
  topicType: string;
};

export async function consolidateDocumentTopicsFlat(input: {
  apiKey: string;
  documentId: string;
  model: string;
  provider: LlmProviderId;
}) {
  const db = getPrisma();
  const rows = await db.topicRecord.findMany({
    orderBy: [{ pageStart: "asc" }, { id: "asc" }],
    where: { documentId: input.documentId, reviewStatus: { in: ["needs_review", "needs_cleanup"] } },
  });
  if (rows.length < 2) return { inputTokens: estimateTokens(JSON.stringify(rows)), merged: 0, tiers: 1 };
  const source: ConsolidationTopic[] = rows.map((topic) => ({
    confidence: topic.confidence,
    id: topic.id,
    sourcePages: topic.sourcePageNumbers,
    summary: topic.summary,
    title: topic.title,
    topicType: topic.topicType,
  }));
  const inputTokens = estimateTokens(JSON.stringify(source));
  let tiers = 1;
  let result: z.infer<typeof consolidatedSchema>;
  if (inputTokens <= CONSOLIDATION_INPUT_BUDGET) {
    result = await consolidateOnce(input, source);
  } else {
    tiers = 2;
    const groups = packContiguous(source, INTERMEDIATE_INPUT_BUDGET);
    const reduced: ConsolidationTopic[] = [];
    for (const group of groups) {
      const intermediate = await consolidateOnce(input, group);
      reduced.push(...intermediate.topics.map((topic) => ({
        confidence: topic.confidence,
        id: topic.sourceTopicIds.join("+"),
        sourcePages: topic.sourcePages,
        summary: topic.summary,
        title: topic.title,
        topicType: topic.topicType,
      })));
    }
    result = await consolidateOnce(input, reduced);
  }
  const valid = validateResult(result, source);
  const consumed = new Set<string>();
  await db.$transaction(async (tx) => {
    for (const topic of valid) {
      const sourceIds = topic.sourceTopicIds.flatMap((id) => id.split("+")).filter((id) => rows.some((row) => row.id === id));
      const keeper = sourceIds[0];
      if (!keeper || consumed.has(keeper)) continue;
      sourceIds.forEach((id) => consumed.add(id));
      const sourceRows = rows.filter((row) => sourceIds.includes(row.id));
      await tx.topicRecord.update({
        data: {
          confidence: topic.confidence,
          discoveryMetadata: {
            consolidatedFrom: sourceIds,
            evidence: sourceRows.map((row) => row.discoveryMetadata),
            version: "flat-consolidation-v1",
          },
          originalSummary: topic.summary,
          originalTitle: topic.title,
          pageEnd: Math.max(...topic.sourcePages),
          pageStart: Math.min(...topic.sourcePages),
          sourcePageNumbers: topic.sourcePages,
          summary: topic.summary,
          title: topic.title,
          topicType: topic.topicType,
        },
        where: { id: keeper },
      });
      await tx.topicRecord.deleteMany({ where: { id: { in: sourceIds.slice(1) } } });
    }
  });
  return { inputTokens, merged: rows.length - valid.length, tiers };
}

async function consolidateOnce(input: { apiKey: string; model: string; provider: LlmProviderId }, topics: ConsolidationTopic[]) {
  const result = await generateText({
    maxOutputTokens: 16_000,
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: consolidatedSchema }),
    prompt: JSON.stringify({ topics }),
    system: "Merge only genuinely duplicate topic drafts into one flat topic list. Preserve all source topic IDs and source pages. Keep distinct topics separate. Do not create parent/child hierarchy or add facts.",
    temperature: 0,
  });
  return consolidatedSchema.parse(result.output);
}

function validateResult(result: z.infer<typeof consolidatedSchema>, source: ConsolidationTopic[]) {
  const known = new Map(source.flatMap((topic) => topic.id.split("+").map((id) => [id, topic] as const)));
  return result.topics.filter((topic) => {
    const ids = topic.sourceTopicIds.flatMap((id) => id.split("+"));
    if (ids.some((id) => !known.has(id))) return false;
    const pages = new Set(ids.flatMap((id) => known.get(id)?.sourcePages ?? []));
    return topic.sourcePages.every((page) => pages.has(page));
  });
}

function packContiguous(topics: ConsolidationTopic[], tokenBudget: number) {
  const groups: ConsolidationTopic[][] = [];
  let current: ConsolidationTopic[] = [];
  for (const topic of topics) {
    if (current.length && estimateTokens(JSON.stringify([...current, topic])) > tokenBudget) {
      groups.push(current); current = [];
    }
    current.push(topic);
  }
  if (current.length) groups.push(current);
  return groups;
}

function estimateTokens(value: string) { return Math.ceil(value.length / 4); }
