export const AVIATION_SOURCE_CLASSIFICATIONS = [
  "controlled-document",
  "open-reference",
  "training-reference",
  "unknown",
] as const;

export const AVIATION_INTENDED_AUDIENCES = ["pilot", "maintenance"] as const;

export type AviationSourceClassification = (typeof AVIATION_SOURCE_CLASSIFICATIONS)[number];
export type IntendedAudience = (typeof AVIATION_INTENDED_AUDIENCES)[number];

// Source metadata may use any two-digit ATA chapter even when a downstream
// EFB installation currently accepts only a smaller configured subset.
export const AVIATION_DOCUMENT_ATA_CHAPTER_IDS = Array.from(
  { length: 100 },
  (_, chapter) => String(chapter).padStart(2, "0"),
);

export type AviationDocumentMetadata = {
  maintenanceAtaChapterIds?: string[];
  pilotQrhTargetIds?: string[];
  aircraftTypeIds: string[];
  sourceClassification: AviationSourceClassification;
  licenseIdentifier: string | null;
  intendedAudiences: IntendedAudience[];
  contentPurpose: string;
};

export type AviationDocumentMetadataInput = {
  maintenanceAtaChapterIds?: unknown;
  pilotQrhTargetIds?: unknown;
  aircraftFamily?: unknown;
  aircraftTypeIds?: unknown;
  ata?: unknown;
  contentPurpose?: unknown;
  effectivity?: unknown;
  intendedAudiences?: unknown;
  licenseIdentifier?: unknown;
  manualType?: unknown;
  revision?: unknown;
  sourceAuthority?: unknown;
  sourceClassification?: unknown;
};

export type NormalizedAviationDocumentMetadata = AviationDocumentMetadata & {
  classificationCode: string | null;
  documentType: string | null;
  effectivity: string | null;
  revision: string | null;
  sourceAuthority: string | null;
  subjectFamily: string | null;
};

const ATA_CODE_PATTERN = /^\d{2}(?:-\d{2}){0,2}$/;
const AIRCRAFT_TYPE_ID_PATTERN = /^[A-Z0-9]{2,4}$/;

export function normalizeAviationDocumentMetadata(
  input: AviationDocumentMetadataInput,
): NormalizedAviationDocumentMetadata {
  const aircraftTypeIds = normalizeAircraftTypeIds(input.aircraftTypeIds);
  const classificationCode = normalizeOptionalString(input.ata);
  if (classificationCode && !ATA_CODE_PATTERN.test(classificationCode)) {
    throw new Error("invalid_aviation_ata");
  }

  const sourceClassification = normalizeOptionalString(input.sourceClassification) || "unknown";
  if (!AVIATION_SOURCE_CLASSIFICATIONS.includes(sourceClassification as AviationSourceClassification)) {
    throw new Error("invalid_aviation_source_classification");
  }

  const intendedAudiences = normalizeIntendedAudiences(input.intendedAudiences);
  if (intendedAudiences.length === 0) {
    throw new Error("aviation_intended_audience_required");
  }

  const contentPurpose = normalizeOptionalString(input.contentPurpose);
  if (!contentPurpose) {
    throw new Error("aviation_content_purpose_required");
  }

  return {
    maintenanceAtaChapterIds: normalizePlacementList(input.maintenanceAtaChapterIds, /^\d{2}$/, "invalid_aviation_ata"),
    pilotQrhTargetIds: normalizePlacementList(input.pilotQrhTargetIds, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid_aviation_qrh"),
    aircraftTypeIds,
    classificationCode,
    contentPurpose,
    documentType: normalizeOptionalString(input.manualType),
    effectivity: normalizeOptionalString(input.effectivity),
    intendedAudiences,
    licenseIdentifier: normalizeOptionalString(input.licenseIdentifier),
    revision: normalizeOptionalString(input.revision),
    sourceAuthority: normalizeOptionalString(input.sourceAuthority),
    sourceClassification: sourceClassification as AviationSourceClassification,
    subjectFamily: normalizeOptionalString(input.aircraftFamily),
  };
}

export function emptyAviationDocumentMetadata() {
  return {
    maintenanceAtaChapterIds: [] as string[],
    pilotQrhTargetIds: [] as string[],
    aircraftTypeIds: [] as string[],
    contentPurpose: null as string | null,
    intendedAudiences: [] as IntendedAudience[],
    licenseIdentifier: null as string | null,
    sourceClassification: null as AviationSourceClassification | null,
  };
}

export function normalizeStoredAviationSourceClassification(
  value: string | null | undefined,
): AviationSourceClassification | null {
  return AVIATION_SOURCE_CLASSIFICATIONS.includes(value as AviationSourceClassification)
    ? value as AviationSourceClassification
    : null;
}

export function normalizeStoredIntendedAudiences(values: string[] | null | undefined) {
  return (values ?? []).filter((value): value is IntendedAudience =>
    AVIATION_INTENDED_AUDIENCES.includes(value as IntendedAudience));
}

export function buildInheritedAviationOkfMetadata(document: {
  maintenanceAtaChapterIds?: string[];
  pilotQrhTargetIds?: string[];
  aircraftFamilyIds?: string[];
  aircraftTypeIds?: string[];
  applicabilityConfidence?: number | null;
  applicabilityEvidence?: string[];
  applicabilityModel?: string | null;
  applicabilityScope?: string | null;
  applicabilityStatus?: string | null;
  classificationCode: string | null;
  contentPurpose?: string | null;
  documentType: string | null;
  effectivity: string | null;
  intendedAudiences?: string[];
  licenseIdentifier?: string | null;
  revision: string | null;
  sourceAuthority: string | null;
  sourceClassification?: string | null;
  sourceType: string;
  subjectFamily: string | null;
}): Record<string, unknown> {
  if (document.sourceType !== "aviation") return {};

  const metadata: Record<string, unknown> = {};
  const ata = document.maintenanceAtaChapterIds?.length
    ? document.maintenanceAtaChapterIds
    : /^\d{2}(?:-\d{2}){0,2}$/.test(document.classificationCode ?? "")
      ? [document.classificationCode!.slice(0, 2)] : [];
  metadata.maintenance_ata_chapter_ids = [...ata];
  metadata.pilot_qrh_target_ids = [...(document.pilotQrhTargetIds ?? [])];
  addString(metadata, "aircraft_family", document.subjectFamily);
  if (document.aircraftFamilyIds?.length) metadata.aircraft_family_ids = [...document.aircraftFamilyIds];
  metadata.aircraft_type_ids = document.applicabilityScope === "entire-family"
    ? [] : [...(document.aircraftTypeIds ?? [])];
  addString(metadata, "applicability_scope", document.applicabilityScope);
  addString(metadata, "applicability_status", document.applicabilityStatus);
  if (typeof document.applicabilityConfidence === "number") {
    metadata.applicability_confidence = document.applicabilityConfidence;
  }
  if (document.applicabilityEvidence?.length) metadata.applicability_evidence = [...document.applicabilityEvidence];
  addString(metadata, "applicability_model", document.applicabilityModel);
  addString(metadata, "ata", document.classificationCode);
  addString(metadata, "manual_type", document.documentType);
  addString(metadata, "source_authority", document.sourceAuthority);
  addString(metadata, "revision", document.revision);
  addString(metadata, "effectivity", document.effectivity);
  addString(metadata, "source_classification", document.sourceClassification);
  addString(metadata, "license_identifier", document.licenseIdentifier);
  if (document.intendedAudiences?.length) metadata.intended_audiences = [...document.intendedAudiences];
  addString(metadata, "content_purpose", document.contentPurpose);
  return metadata;
}

export const AVIATION_INHERITED_OKF_FIELDS = new Set([
  "maintenance_ata_chapter_ids",
  "pilot_qrh_target_ids",
  "aircraft_family",
  "aircraft_family_ids",
  "aircraft_type_ids",
  "applicability_scope",
  "applicability_status",
  "applicability_confidence",
  "applicability_evidence",
  "applicability_model",
  "ata",
  "manual_type",
  "source_authority",
  "revision",
  "effectivity",
  "source_classification",
  "license_identifier",
  "intended_audiences",
  "content_purpose",
]);

export function replaceInheritedAviationOkfMetadata(
  current: Record<string, unknown>,
  document: Parameters<typeof buildInheritedAviationOkfMetadata>[0],
) {
  const next = { ...current };
  for (const field of AVIATION_INHERITED_OKF_FIELDS) delete next[field];
  return { ...next, ...buildInheritedAviationOkfMetadata(document) };
}

export function resolveTopicPlacementMetadata(metadata: Record<string, unknown>, pages: Array<{pageNumber: number; text: string}>) {
  const result = { ...metadata };
  for (const [scopeKey, targetKey] of [["maintenance_ata_chapter_ids", "maintenance_ata_chapter"], ["pilot_qrh_target_ids", "pilot_qrh_target_id"]]) {
    const scope = normalizeStringList(metadata[scopeKey]);
    if (!scope.length || result[targetKey]) continue;
    const matched = scope.filter(id => pages.some(p => p.text.split(/\r?\n/).some(line => {
      const heading = line.trim().toLowerCase();
      return scopeKey === "maintenance_ata_chapter_ids"
        ? new RegExp(`^(?:ata\\s+)?${id}-\\d{2}-\\d{2}(?:\\s|$)`, "i").test(heading)
        : heading === id.replaceAll("-", " ");
    })));
    if (scope.length === 1) result[targetKey] = scope[0];
    else if (matched.length === 1) result[targetKey] = matched[0];
  }
  return result;
}

function normalizeAircraftTypeIds(value: unknown) {
  const values = normalizeStringList(value).map((item) => item.toUpperCase());
  for (const item of values) {
    if (!AIRCRAFT_TYPE_ID_PATTERN.test(item)) throw new Error("invalid_aviation_aircraft_type_id");
  }
  return [...new Set(values)];
}

function normalizeIntendedAudiences(value: unknown): IntendedAudience[] {
  const values = normalizeStringList(value);
  if (values.includes("both")) values.push("pilot", "maintenance");
  const normalized = [...new Set(values.filter((item) => item !== "both"))];
  if (!normalized.every((item) => AVIATION_INTENDED_AUDIENCES.includes(item as IntendedAudience))) {
    throw new Error("invalid_aviation_intended_audience");
  }
  return normalized as IntendedAudience[];
}

function normalizeStringList(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePlacementList(value: unknown, pattern: RegExp, error: string) {
  if (value !== undefined && value !== null && typeof value !== "string" && !Array.isArray(value)) throw new Error(error);
  if (Array.isArray(value) && value.some(item => typeof item !== "string")) throw new Error(error);
  const values = [...new Set(normalizeStringList(value))];
  if (values.length > 100 || values.some(item => !pattern.test(item))) throw new Error(error);
  return values.sort();
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addString(target: Record<string, unknown>, key: string, value: string | null | undefined) {
  if (value?.trim()) target[key] = value.trim();
}
