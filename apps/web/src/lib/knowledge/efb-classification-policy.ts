import { z } from "zod";
import type { ProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";
import {
  deterministicClassification,
  type ClassificationEvidence,
  type ApplicabilitySource,
} from "./efb-classification-core.ts";

export const CLASSIFICATION_POLICY = "efb-classification-v1";
export const predictionSchema = z
  .object({
    audiences: z.array(z.enum(["pilot", "maintenance"])).max(2),
    ataChapter: z.string().nullable(),
    qrhTargetId: z.string().nullable(),
    rationale: z.string().max(2000),
    evidence: z
      .array(
        z.object({
          field: z.enum(["audience", "ata", "qrh"]),
          id: z.string(),
          quote: z.string().min(10).max(2000),
        }),
      )
      .max(20),
    ambiguous: z.boolean(),
  })
  .strict();
export type Prediction = z.infer<typeof predictionSchema>;
export const ATA_LABELS: Record<string, string> = {
  "05": "Time limits and maintenance checks",
  "12": "Servicing",
  "21": "Air conditioning",
  "24": "Electrical power",
  "27": "Flight controls",
  "29": "Hydraulic power",
  "32": "Landing gear",
  "34": "Navigation",
  "36": "Pneumatics",
  "42": "Integrated modular avionics",
  "52": "Doors",
  "73": "Engine fuel and control",
};
export function classificationVocabulary(registry: ProjectEfbContractRegistry) {
  return {
    ...registry,
    ata: registry.placements.ataChapterIds.map((id) => ({
      id,
      label: ATA_LABELS[id] ?? `ATA ${id}`,
    })),
    qrh: registry.placements.qrhTargetIds.map((id) => ({
      id,
      label: id.replaceAll("-", " "),
    })),
  };
}
export function evaluateClassification(
  registry: ProjectEfbContractRegistry,
  evidence: ClassificationEvidence[],
  documents: ApplicabilitySource[],
  prediction: Prediction,
) {
  const detected = deterministicClassification(registry, evidence, documents);
  const issues = [...detected.issues];
  const citations = prediction.evidence.filter((ref) =>
    evidence.some(
      (e) =>
        e.id === ref.id &&
        e.quote.replace(/\s+/g, " ").includes(ref.quote.replace(/\s+/g, " ")),
    ),
  );
  if (citations.length !== prediction.evidence.length)
    issues.push("invalid_evidence_quote");
  const has = (field: string) => citations.some((e) => e.field === field);
  if (!has("audience") || !prediction.audiences.length)
    issues.push("audience_evidence_missing");
  let ataChapter =
    detected.ataChapters.length === 1
      ? detected.ataChapters[0]
      : prediction.ataChapter;
  if (prediction.audiences.includes("maintenance")) {
    if (!ataChapter || !registry.placements.ataChapterIds.includes(ataChapter))
      issues.push("ata_target_missing_or_unsupported");
    if (!has("ata")) issues.push("ata_evidence_missing");
    if (
      detected.ataChapters.length === 1 &&
      prediction.ataChapter &&
      ataChapter !== prediction.ataChapter
    )
      issues.push("ata_conflict");
  } else ataChapter = null;
  const qrhTargetId = prediction.audiences.includes("pilot")
    ? prediction.qrhTargetId
    : null;
  if (
    prediction.audiences.includes("pilot") &&
    (!qrhTargetId ||
      !registry.placements.qrhTargetIds.includes(qrhTargetId) ||
      !has("qrh"))
  )
    issues.push("qrh_target_or_evidence_missing");
  if (prediction.ambiguous) issues.push("model_reports_ambiguity");
  const status = issues.some(
    (i) =>
      i.includes("unsupported") ||
      i === "aircraft_evidence_missing" ||
      i === "invalid_evidence_quote",
  )
    ? "blocked"
    : issues.length
      ? "needs_review"
      : "ready";
  return {
    status,
    confidence: status === "ready" ? "high" : "low",
    issues: [...new Set(issues)],
    metadata: {
      aircraftFamily: detected.aircraftFamilyIds[0] ?? "",
      aircraftTypeIds: detected.aircraftTypeIds,
      audiences: [...new Set(prediction.audiences)],
      ataChapter,
      qrhTargetId,
    },
    detected,
    evidence: citations,
    rationale: prediction.rationale,
  };
}
