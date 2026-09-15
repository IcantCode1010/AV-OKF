import type { ProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";
import { buildInheritedAviationOkfMetadata } from "../aviation-document-metadata.ts";

type Source = Parameters<typeof buildInheritedAviationOkfMetadata>[0];
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

// A multi-section manual supplies a scope; only an explicit topic selection narrows it.
export function evaluateInheritedEfbMetadata(
  registry: ProjectEfbContractRegistry,
  documents: Source[],
  saved: Record<string, unknown> = {},
) {
  const issues: string[] = [];
  const inherited = documents.map(buildInheritedAviationOkfMetadata);
  const common = (key: string) => {
    const values = inherited.map(m => list(m[key]));
    return values.length ? [...new Set(values[0])].filter(v => values.every(a => a.includes(v))).sort() : [];
  };
  const families = common("aircraft_family_ids");
  // Generated educational topics apply to the evidenced NG or MAX group.
  // Source-level type IDs are provenance and do not narrow automation.
  const types: string[] = [];
  if (documents.some(d => !["accepted", "manual_override"].includes(d.applicabilityStatus ?? ""))) issues.push("document_applicability_needs_review");
  const family = families.length === 1 ? families[0] : "";
  const registered = registry.aircraftFamilies.find(f => f.id === family);
  if (!registered) issues.push("document_aircraft_missing_or_unsupported");
  const audiences = common("intended_audiences");
  if (!audiences.length || audiences.some(a => !["pilot", "maintenance"].includes(a))) issues.push("document_audience_missing_or_conflicting");
  const pick = (key: string, selectedKey: string, allowed: string[], required: boolean) => {
    if (!required) return null;
    const scope = common(key);
    const selected = typeof saved[selectedKey] === "string" ? saved[selectedKey] as string : null;
    const value = selected ?? (scope.length === 1 ? scope[0] : null);
    if (!value || !scope.includes(value) || !allowed.includes(value)) {
      issues.push(`${selectedKey}_missing_ambiguous_or_outside_document_scope`);
      return null;
    }
    return value;
  };
  const ataChapter = pick("maintenance_ata_chapter_ids", "maintenance_ata_chapter", registry.placements.ataChapterIds, audiences.includes("maintenance"));
  const qrhTargetId = pick("pilot_qrh_target_ids", "pilot_qrh_target_id", registry.placements.qrhTargetIds, audiences.includes("pilot"));
  // Revisions retain their metadata snapshot. A changed document requires a fresh revision/decision.
  for (const key of ["aircraft_family_ids", "intended_audiences", "maintenance_ata_chapter_ids", "pilot_qrh_target_ids"]) {
    if (saved[key] !== undefined && documents.length === 1 &&
      JSON.stringify(list(saved[key]).map(v => v.toLowerCase()).sort()) !==
      JSON.stringify(list(inherited[0][key]).map(v => v.toLowerCase()).sort())) issues.push("inherited_metadata_changed");
  }
  return {
    status: issues.length ? "needs_review" : "ready",
    confidence: issues.length ? "low" : "high",
    issues: [...new Set(issues)],
    metadata: { aircraftFamily: family, aircraftTypeIds: types, audiences, ataChapter, qrhTargetId },
    detected: { aircraftFamilyIds: families, aircraftTypeIds: types, ataChapters: common("maintenance_ata_chapter_ids"), issues },
    evidence: [] as Array<{
      field: "audience" | "ata" | "qrh";
      id: string;
      quote: string;
    }>,
    rationale: issues.length ? "Correct the document metadata or select the topic's source section before EFB export." : "Aircraft, audience, and placement inherited from the source document metadata.",
  };
}
