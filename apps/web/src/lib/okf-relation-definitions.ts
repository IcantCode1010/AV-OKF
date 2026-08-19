export const RELATION_DEFINITIONS: Record<string, string> = {
  affects: "The source changes or has a stated effect on the target.",
  applies_to: "The source explicitly applies to the target entity, system, product, or scope.",
  conflicts_with: "The source is incompatible with or contradicts the target.",
  covered_by: "The source subject is governed or comprehensively addressed by the target.",
  depends_on: "The source cannot be applied or understood without the target.",
  governs: "The source establishes an authoritative rule or policy governing the target.",
  implements: "The source puts the target policy, requirement, or design into practice.",
  mitigates: "The source reduces or controls the risk, condition, or effect represented by the target.",
  part_of: "The source is explicitly a component or subordinate part of the target.",
  references: "The source explicitly points to or cites the target.",
  requires: "The source explicitly requires the target as an input, prerequisite, component, or condition.",
  routes_to: "The source directs the reader or workflow to the target.",
  supersedes: "The source replaces the target as current guidance.",
  supports: "The source provides direct supporting evidence or detail for the target.",
  triggers: "The source explicitly initiates or activates the target procedure, event, or response.",
};

export function formatRelationLabel(relation: string) {
  return relation
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function humanizeRelationFailure(input: {
  automaticApprovalError: string | null;
  rationale: string | null;
  verificationError: string | null;
}) {
  const code = input.automaticApprovalError ?? input.verificationError;
  if (code) {
    const normalized = code.toLowerCase();
    if (normalized.includes("target_not_identified")) return "The source quote did not identify the proposed target concept.";
    if (normalized.includes("rationale_not_pair_specific")) return "The explanation did not specifically connect both concepts.";
    if (normalized.includes("publishing_suspended")) return "Automatic relation publishing is suspended while relation precision is evaluated.";
    if (normalized.includes("quote") || normalized.includes("evidence")) return "No exact source evidence supported this relationship.";
    if (normalized.includes("relation") && normalized.includes("allowed")) return "The proposed relationship type is not allowed by this bundle.";
    if (normalized.includes("stale") || normalized.includes("content_hash")) return "A concept changed after verification and must be checked again.";
    if (normalized.includes("missing") || normalized.includes("not_found")) return "One of the concepts is no longer available.";
    return humanizeCode(code);
  }
  return input.rationale?.trim() || "The verifier did not find enough evidence for this relationship.";
}

function humanizeCode(value: string) {
  return value.replaceAll("_", " ").replaceAll(":", ": ").replaceAll(/\s+/g, " ").trim();
}
