export type TopicRelation = {
  approvalMode?: "automated" | "human" | null;
  relation: string;
  target: string;
  targetType: string | null;
  reason: string;
  verificationConfidence?: number | null;
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
      const normalized: TopicRelation = {
        ...(
          candidate.approvalMode === "automated" || candidate.approvalMode === "human"
            ? { approvalMode: candidate.approvalMode }
            : {}
        ),
        relation: typeof candidate.relation === "string" ? candidate.relation : "",
        target: typeof candidate.target === "string" ? candidate.target : "",
        targetType:
          typeof candidate.targetType === "string" ? candidate.targetType : null,
        reason: typeof candidate.reason === "string" ? candidate.reason : "",
        ...(
          typeof candidate.verificationConfidence === "number" &&
              Number.isFinite(candidate.verificationConfidence)
            ? { verificationConfidence: candidate.verificationConfidence }
            : {}
        ),
      };
      return normalized;
    })
    .filter((entry): entry is TopicRelation => entry !== null);
}
