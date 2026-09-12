import type { ClassificationEvidence } from "./efb-classification-core.ts";

export type ClassificationEvidenceField = "audience" | "ata" | "qrh";
export type ClassificationEvidenceReference = {
  field: ClassificationEvidenceField;
  id: string;
  quote: string;
};
export type DiscardedClassificationEvidence =
  ClassificationEvidenceReference & {
    reason: "evidence_id_missing" | "quote_not_exact";
  };

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export function evaluateClassificationEvidence(
  source: ClassificationEvidence[],
  proposed: ClassificationEvidenceReference[],
) {
  const valid: ClassificationEvidenceReference[] = [];
  const discarded: DiscardedClassificationEvidence[] = [];

  for (const reference of proposed) {
    const evidence = source.find((item) => item.id === reference.id);
    if (!evidence) {
      discarded.push({ ...reference, reason: "evidence_id_missing" });
      continue;
    }
    if (!normalize(evidence.quote).includes(normalize(reference.quote))) {
      discarded.push({ ...reference, reason: "quote_not_exact" });
      continue;
    }
    valid.push(reference);
  }

  const byField = (field: ClassificationEvidenceField) =>
    valid.filter((reference) => reference.field === field);

  return {
    valid,
    discarded,
    byField,
    warnings: discarded.length ? ["discarded_invalid_evidence"] : [],
  };
}
