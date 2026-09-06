// EFB application keys, not ICAO designators. Keep aligned with
// Project-EFB-MX/src/aircraft/registry.ts (checked 2026-09-06).
export const EFB_AIRCRAFT_FAMILIES = [
  { id: "737-ng", label: "Boeing 737 Next Generation", types: [
    { id: "b738", label: "Boeing 737-800", model: "737-800" },
  ] },
  { id: "a320-family", label: "Airbus A320 family", types: [
    { id: "a320", label: "Airbus A320neo", model: "A320-251N" },
  ] },
] as const;

export function normalizeEfbAircraftFamily(value: string) {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["737ng", "boeing737ng", "boeing737nextgeneration"].includes(key)) return "737-ng";
  if (["a320family", "airbusa320family"].includes(key)) return "a320-family";
  return value.trim();
}

export function matchesEfbAircraftFamily(familyId: string, typeIds: readonly string[]) {
  const family = EFB_AIRCRAFT_FAMILIES.find((item) => item.id === normalizeEfbAircraftFamily(familyId));
  return !!family && typeIds.length > 0 && typeIds.every((id) => family.types.some((type) => type.id === id));
}
