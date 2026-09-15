export type RelationTargetTopic = {
  id: string; title: string; enrichedTitle: string | null; enrichedSummary: string | null;
  enrichedBody: string | null; summary: string; okfMetadata: unknown; exportedFilePath: string | null;
};
export type RelationTargetInput<T extends RelationTargetTopic> = {
  topics: T[];
  aliases: Array<{ normalizedValue: string; entity: { topicLinks: Array<{ topicId: string }> } }>;
  assertion: { sourceTopicId?: string; targetAnchor: string | null; targetResolutionValue: string | null; evidenceQuote?: string };
};
export type TargetResolutionStrategy = "explicit_name" | "accepted_alias" | "unique_anchor" | "unique_title_phrase";

export function normalizeEntityTargetName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Resolves candidate destinations only. Publication still requires relationship verification. */
export function resolveEntityRelationTarget<T extends RelationTargetTopic>(input: RelationTargetInput<T>):
  { target: T; strategy: TargetResolutionStrategy } | { target: null; reason: "missing_target" | "ambiguous_target" | "self_reference" | "no_match" } {
  const value = normalizeEntityTargetName(input.assertion.targetResolutionValue ?? "");
  const titles = (topic: T) => [topic.title, topic.enrichedTitle].filter((title): title is string => Boolean(title)).map(normalizeEntityTargetName);
  const topics = input.topics.filter((topic) => topic.id !== input.assertion.sourceTopicId && topic.exportedFilePath);
  if (!value && !input.assertion.targetAnchor) return { target: null, reason: "missing_target" };
  const exact = value ? topics.filter((topic) => titles(topic).includes(value)) : [];
  if (exact.length === 1) return { target: exact[0], strategy: "explicit_name" };
  if (exact.length > 1) return { target: null, reason: "ambiguous_target" };
  const aliasIds = new Set(input.aliases.filter((alias) => normalizeEntityTargetName(alias.normalizedValue) === value)
    .flatMap((alias) => alias.entity.topicLinks.map((link) => link.topicId)));
  const aliases = topics.filter((topic) => aliasIds.has(topic.id));
  if (aliases.length === 1) return { target: aliases[0], strategy: "accepted_alias" };
  if (aliases.length > 1) return { target: null, reason: "ambiguous_target" };
  const anchor = normalizeEntityTargetName(input.assertion.targetAnchor ?? "");
  if (anchor.length >= 3) {
    const matches = topics.filter((topic) => ` ${normalizeEntityTargetName([
      topic.enrichedTitle ?? topic.title, topic.enrichedSummary ?? topic.summary, topic.enrichedBody ?? "", JSON.stringify(topic.okfMetadata),
    ].join(" "))} `.includes(` ${anchor} `));
    if (matches.length === 1) return { target: matches[0], strategy: "unique_anchor" };
    if (matches.length > 1) return { target: null, reason: "ambiguous_target" };
  }
  if (input.topics.some((topic) => topic.id === input.assertion.sourceTopicId && titles(topic).includes(value))) return { target: null, reason: "self_reference" };
  const significant = value.split(" ").filter((word) => !["the", "a", "an", "and", "of", "to", "for", "in", "on", "with"].includes(word));
  // A distinctive, explicitly quoted multiword name may occur inside a longer
  // approved heading. Never pick a fuzzy winner or a body-only name mention.
  if (significant.length >= 2 && ` ${normalizeEntityTargetName(input.assertion.evidenceQuote ?? "")} `.includes(` ${value} `)) {
    const matches = topics.filter((topic) => titles(topic).some((title) => ` ${title} `.includes(` ${value} `)));
    if (matches.length === 1) return { target: matches[0], strategy: "unique_title_phrase" };
    if (matches.length > 1) return { target: null, reason: "ambiguous_target" };
  }
  return { target: null, reason: "no_match" };
}
