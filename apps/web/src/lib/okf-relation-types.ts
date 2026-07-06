export type TopicRelation = {
  relation: string;
  target: string;
  targetType: string | null;
  reason: string;
};

export function normalizeTopicRelations(value: unknown): TopicRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<Record<keyof TopicRelation, unknown>>;
      return {
        relation: typeof candidate.relation === "string" ? candidate.relation : "",
        target: typeof candidate.target === "string" ? candidate.target : "",
        targetType:
          typeof candidate.targetType === "string" ? candidate.targetType : null,
        reason: typeof candidate.reason === "string" ? candidate.reason : "",
      };
    })
    .filter((entry): entry is TopicRelation => entry !== null);
}
