import { normalizeTopicRelations, type TopicRelation } from "./okf-relation-types.ts";

export const RELATION_STABILIZATION_CONFIRMATION = "CLEAR_ALL_PENDING_RELATIONS";
export const MIN_RELATION_RATIONALE_LENGTH = 40;

export function isWeakPublishedRelationRationale(value: string | null | undefined) {
  return !value || value.trim().length < MIN_RELATION_RATIONALE_LENGTH;
}

export function resolvePublishedRelationSnapshot(candidate: {
  reason: string;
  relation: string;
  sourceFile: string;
  targetFile: string;
  verificationDirection: string | null;
  verificationRelation: string | null;
}) {
  const reverse = candidate.verificationDirection === "reverse";
  return {
    direction: reverse ? "reverse" as const : "proposed" as const,
    publishedRelation: candidate.verificationRelation ?? candidate.relation,
    publishedReason: candidate.reason,
    publishedSourceFile: reverse ? candidate.targetFile : candidate.sourceFile,
    publishedTargetFile: reverse ? candidate.sourceFile : candidate.targetFile,
  };
}

export function topicContainsPublishedRelation(
  relations: unknown,
  snapshot: { publishedRelation: string; publishedTargetFile: string },
) {
  return normalizeTopicRelations(relations).some((relation) =>
    relation.relation === snapshot.publishedRelation &&
    relation.target === snapshot.publishedTargetFile
  );
}

export function applyPublishedRelationReview(input: {
  confidence: number | null;
  decision: "reapprove" | "reject";
  nextReason: string;
  publishedRelation: string;
  publishedTargetFile: string;
  relations: unknown;
}): TopicRelation[] {
  const relations = normalizeTopicRelations(input.relations);
  const relationIndex = relations.findIndex((relation) =>
    relation.relation === input.publishedRelation &&
    relation.target === input.publishedTargetFile
  );
  if (relationIndex < 0) throw new Error("published_relation_missing");
  if (input.decision === "reject") return relations.filter((_, index) => index !== relationIndex);
  return relations.map((relation, index) => index === relationIndex
    ? {
        ...relation,
        approvalMode: "human",
        reason: input.nextReason,
        verificationConfidence: input.confidence,
      }
    : relation);
}

export function parseRelationStabilizationOptions(args: string[]) {
  const apply = args.includes("--apply");
  const confirmationIndex = args.indexOf("--confirm");
  const confirmation = confirmationIndex >= 0 ? args[confirmationIndex + 1] : undefined;
  if (apply && confirmation !== RELATION_STABILIZATION_CONFIRMATION) {
    throw new Error(`relation_stabilization_confirmation_required:${RELATION_STABILIZATION_CONFIRMATION}`);
  }
  return { apply };
}
