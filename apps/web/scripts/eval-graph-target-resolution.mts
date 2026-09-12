import { readFile } from "node:fs/promises";
import { resolveEntityRelationTarget, normalizeEntityTargetName, type RelationTargetInput, type RelationTargetTopic } from "../src/lib/entity-relation-target.ts";

const filename = process.argv[2];
if (!filename) throw Error("Provide a read-only graph-target-resolution-input.json snapshot path.");
const input = JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/, "")) as {
  topics: RelationTargetTopic[];
  aliases: RelationTargetInput<RelationTargetTopic>["aliases"];
  assertions: Array<RelationTargetInput<RelationTargetTopic>["assertion"] & { id: string }>;
};
const counts: Record<string, number> = {};
let eligible = 0;
let missingSource = 0;
const published = new Set(input.topics.map((topic) => topic.id));
for (const assertion of input.assertions) {
  const result = resolveEntityRelationTarget({ ...input, assertion });
  const category = result.target ? result.strategy : result.reason;
  counts[category] = (counts[category] ?? 0) + 1;
  if (!published.has(assertion.sourceTopicId ?? "")) missingSource++;
  else if (result.target) eligible++;
}
// Baseline: the former production resolver searched all topics, including the source.
let baseline = 0;
const canonical = (value: string) => value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
for (const assertion of input.assertions) {
  const exact = input.topics.filter((topic) => [topic.title, topic.enrichedTitle].some((title) => title && normalizeEntityTargetName(title) === assertion.targetResolutionValue));
  const aliasIds = new Set(input.aliases.filter((alias) => alias.normalizedValue === assertion.targetResolutionValue).flatMap((alias) => alias.entity.topicLinks.map((link) => link.topicId)));
  const aliases = input.topics.filter((topic) => aliasIds.has(topic.id));
  const anchors = assertion.targetAnchor ? input.topics.filter((topic) => canonical([topic.enrichedTitle ?? topic.title, topic.enrichedSummary ?? topic.summary, topic.enrichedBody ?? "", JSON.stringify(topic.okfMetadata)].join(" ")).includes(canonical(assertion.targetAnchor!))) : [];
  const target = exact.length === 1 ? exact[0] : aliases.length === 1 ? aliases[0] : anchors.length === 1 ? anchors[0] : null;
  if (target && target.id !== assertion.sourceTopicId && published.has(assertion.sourceTopicId ?? "")) baseline++;
}
console.log(JSON.stringify({ mode: "read_only_destination_resolution_not_relationship_verification", assertions: input.assertions.length, publishedTopics: input.topics.length, baselineEligible: baseline, proposedEligible: eligible, missingPublishedSource: missingSource, outcomes: counts }, null, 2));
