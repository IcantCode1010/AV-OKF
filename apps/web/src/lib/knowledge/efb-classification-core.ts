import type { ProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";

export type ClassificationEvidence = {
  id: string;
  documentId: string;
  page: number;
  quote: string;
};
export type ApplicabilitySource = {
  aircraftFamilyIds: string[];
  aircraftTypeIds: string[];
  applicabilityStatus: string | null;
};
// Aliases translate evidence; only registry membership grants eligibility.
const aliases: Record<string, string[]> = {
  "737-ng": ["737ng", "737 ng", "737 next generation", "737-700", "737-800", "737-900", "737-900er"],
  "737-max": ["737 max", "737max", "max 7", "max 8", "max 9", "max 10", "737-7", "737-8", "737-9", "737-10"],
  b738: ["b738", "737-800"],
  a320: ["a320 family"],
  "a320-251n": ["a320-251n"],
};
function mentions(text: string, id: string) {
  return [id, ...(aliases[id] ?? [])].some((value) =>
    new RegExp(
      `(^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
      "i",
    ).test(text),
  );
}
export function deterministicClassification(
  registry: ProjectEfbContractRegistry,
  evidence: ClassificationEvidence[],
  documents: ApplicabilitySource[],
) {
  const families = new Set<string>(),
    types = new Set<string>(),
    ata = new Set<string>(),
    issues: string[] = [];
  for (const document of documents) {
    if (
      !["accepted", "manual_override"].includes(
        document.applicabilityStatus ?? "",
      )
    )
      continue;
    document.aircraftFamilyIds.forEach((id) => families.add(id));
    // Type IDs are retained on source records for provenance only. Automated
    // topic applicability is the NG or MAX educational group.
  }
  const hasAuthoritativeApplicability = families.size > 0 || types.size > 0;
  for (const e of evidence) {
    // Accepted document applicability is the authority. Evidence text is only
    // a fallback for older documents that have not been classified yet.
    if (!hasAuthoritativeApplicability)
      for (const family of registry.aircraftFamilies) {
        if (mentions(e.quote, family.id)) families.add(family.id);
      }
    for (const match of e.quote.matchAll(/\bATA[\s-]*(\d{2})(?:-\d{2})?\b/gi))
      ata.add(match[1]);
  }
  if (
    [...families].some(
      (id) => !registry.aircraftFamilies.some((f) => f.id === id),
    )
  )
    issues.push("unsupported_aircraft_family");
  if (families.size !== 1)
    issues.push(
      families.size
        ? "conflicting_aircraft_families"
        : "aircraft_evidence_missing",
    );
  if (ata.size > 1) issues.push("multiple_ata_chapters");
  if ([...ata].some((id) => !registry.placements.ataChapterIds.includes(id)))
    issues.push("unsupported_ata");
  return {
    aircraftFamilyIds: [...families].sort(),
    aircraftTypeIds: [],
    ataChapters: [...ata].sort(),
    issues: [...new Set(issues)],
  };
}
