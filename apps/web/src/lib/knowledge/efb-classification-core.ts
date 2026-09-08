import type { ProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";

export type ClassificationEvidence = { id: string; documentId: string; page: number; quote: string };
export type ApplicabilitySource = { aircraftFamilyIds: string[]; aircraftTypeIds: string[]; applicabilityStatus: string | null };
// Aliases translate evidence; only registry membership grants eligibility.
const aliases: Record<string, string[]> = {
  "737-ng": ["737ng", "737 ng", "737 next generation"],
  "b738": ["b738", "737-800"],
  "a320": ["a320 family"],
  "a320-251n": ["a320-251n"],
};
function mentions(text: string, id: string) {
  return [id, ...(aliases[id] ?? [])].some(value => new RegExp(`(^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text));
}
export function deterministicClassification(registry: ProjectEfbContractRegistry, evidence: ClassificationEvidence[], documents: ApplicabilitySource[]) {
  const families = new Set<string>(), types = new Set<string>(), ata = new Set<string>(), issues: string[] = [];
  for (const document of documents) {
    if (!["accepted", "manual_override"].includes(document.applicabilityStatus ?? "")) continue;
    document.aircraftFamilyIds.forEach(id => families.add(id));
    document.aircraftTypeIds.forEach(id => types.add(id.toLowerCase()));
  }
  for (const e of evidence) {
    for (const family of registry.aircraftFamilies) {
      if (mentions(e.quote, family.id)) families.add(family.id);
      for (const type of family.aircraftTypeIds) if (mentions(e.quote, type)) types.add(type);
    }
    for (const match of e.quote.matchAll(/\bATA[\s-]*(\d{2})(?:-\d{2})?\b/gi)) ata.add(match[1]);
  }
  for (const type of types) {
    const family = registry.aircraftFamilies.find(f => f.aircraftTypeIds.includes(type));
    if (!family) issues.push("unsupported_aircraft_type");
    else families.add(family.id);
  }
  if ([...families].some(id => !registry.aircraftFamilies.some(f => f.id === id))) issues.push("unsupported_aircraft_family");
  if (families.size !== 1) issues.push(families.size ? "conflicting_aircraft_families" : "aircraft_evidence_missing");
  if (ata.size > 1) issues.push("multiple_ata_chapters");
  if ([...ata].some(id => !registry.placements.ataChapterIds.includes(id))) issues.push("unsupported_ata");
  return { aircraftFamilyIds: [...families].sort(), aircraftTypeIds: [...types].sort(), ataChapters: [...ata].sort(), issues: [...new Set(issues)] };
}
