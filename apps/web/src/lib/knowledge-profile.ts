export type KnowledgeFolderCategory =
  | "concepts"
  | "indexes"
  | "procedures"
  | "references"
  | "routing";

export type KnowledgeFieldType =
  | "date"
  | "number"
  | "number_array"
  | "relations"
  | "string"
  | "string_array";

export type KnowledgeProfileSchema = {
  automation: {
    autoApproveEnrichedTopics: boolean;
  };
  clarificationFields: string[];
  fields: Record<string, { required?: boolean; type: KnowledgeFieldType }>;
  id: string;
  name: string;
  relations: string[];
  types: Record<string, { category: KnowledgeFolderCategory; label: string }>;
};

export const DEFAULT_CLARIFICATION_FIELDS = [
  "subject_family",
  "classification_code",
  "document_type",
  "tags",
] as const;

export const PROHIBITED_CLARIFICATION_FIELDS = new Set([
  "coverage_type",
  "covered_rag_chunk_ids",
  "approved_at",
  "approved_by",
  "knowledge_version",
  "last_verified",
  "relations",
  "review_status",
  "revision",
  "source_authority",
  "source_pages",
]);

const CLARIFICATION_FIELD_TYPES = new Set<KnowledgeFieldType>([
  "date",
  "number",
  "string",
  "string_array",
]);

export const DEFAULT_RELATIONS = [
  "routes_to",
  "references",
  "supports",
  "covered_by",
  "supersedes",
  "conflicts_with",
  "depends_on",
] as const;

export const BASE_FIELDS: KnowledgeProfileSchema["fields"] = {
  type: { required: true, type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  tags: { type: "string_array" },
  updated: { type: "date" },
  approved_at: { type: "date" },
  approved_by: { type: "string" },
  review_status: { type: "string" },
  source_file: { type: "string" },
  source_pages: { type: "number_array" },
  source_authority: { type: "string" },
  knowledge_version: { type: "string" },
  relations: { type: "relations" },
  classification_code: { type: "string" },
  coverage_type: { type: "string" },
  covered_rag_chunk_ids: { type: "string_array" },
  document_type: { type: "string" },
  effectivity: { type: "string" },
  revision: { type: "string" },
  subject_family: { type: "string" },
};

export const GENERIC_PROFILE_TEMPLATE: KnowledgeProfileSchema = {
  automation: { autoApproveEnrichedTopics: false },
  clarificationFields: [...DEFAULT_CLARIFICATION_FIELDS],
  fields: BASE_FIELDS,
  id: "generic",
  name: "Generic",
  relations: [...DEFAULT_RELATIONS],
  types: {
    concept: { category: "concepts", label: "Concept" },
    metric: { category: "references", label: "Metric" },
    policy: { category: "concepts", label: "Policy" },
    procedure: { category: "procedures", label: "Procedure" },
    reference: { category: "references", label: "Reference" },
    source_manifest: { category: "indexes", label: "Source manifest" },
    system: { category: "concepts", label: "System" },
    system_topic: { category: "concepts", label: "System topic" },
  },
};

export const AVIATION_PROFILE_TEMPLATE: KnowledgeProfileSchema = {
  ...GENERIC_PROFILE_TEMPLATE,
  clarificationFields: [...DEFAULT_CLARIFICATION_FIELDS],
  fields: {
    ...BASE_FIELDS,
    aircraft_family: { type: "string" },
    aircraft_variant: { type: "string" },
    ata: { type: "string" },
    effectivity: { type: "string" },
    manual_type: { type: "string" },
    revision: { type: "string" },
  },
  id: "aviation",
  name: "Aviation",
  types: {
    ...GENERIC_PROFILE_TEMPLATE.types,
    aircraft_index: { category: "indexes", label: "Aircraft index" },
    ata_index: { category: "indexes", label: "ATA index" },
    dispatch_reference: { category: "references", label: "Dispatch reference" },
    fault_route: { category: "routing", label: "Fault route" },
    training_reference: { category: "references", label: "Training reference" },
    wiring_reference: { category: "references", label: "Wiring reference" },
  },
};

export function getKnowledgeProfileTemplate(id: string): KnowledgeProfileSchema {
  if (id === "aviation") return structuredClone(AVIATION_PROFILE_TEMPLATE);
  return structuredClone(GENERIC_PROFILE_TEMPLATE);
}

export function normalizeKnowledgeProfile(
  profile: KnowledgeProfileSchema,
): KnowledgeProfileSchema {
  const normalized = structuredClone(profile);
  normalized.automation = {
    autoApproveEnrichedTopics:
      normalized.automation?.autoApproveEnrichedTopics === true,
  };
  if (!Array.isArray(normalized.clarificationFields)) {
    normalized.clarificationFields = ["generic", "aviation"].includes(normalized.id)
      ? DEFAULT_CLARIFICATION_FIELDS.filter((field) => Boolean(normalized.fields[field]))
      : [];
  }
  return normalized;
}

export function getTypeDirectory(profile: KnowledgeProfileSchema, type: string): string {
  const definition = profile.types[type];
  if (!definition) throw new Error(`knowledge_profile_type_not_allowed:${type}`);
  return `${definition.category}/${type.replaceAll("_", "-")}`;
}

export function validateKnowledgeProfile(profile: KnowledgeProfileSchema): string[] {
  const errors: string[] = [];
  if (typeof profile.automation?.autoApproveEnrichedTopics !== "boolean") {
    errors.push("knowledge_profile_automation_invalid");
  }
  if (profile.fields.type?.required !== true || profile.fields.type.type !== "string") {
    errors.push("knowledge_profile_type_field_required");
  }
  for (const field of ["title", "description", "tags", "updated"]) {
    if (!profile.fields[field]) errors.push(`knowledge_profile_base_field_missing:${field}`);
  }
  if (Object.keys(profile.types).length === 0) errors.push("knowledge_profile_types_required");
  const clarificationFields = Array.isArray(profile.clarificationFields)
    ? profile.clarificationFields
    : [];
  const seenClarificationFields = new Set<string>();
  for (const field of clarificationFields) {
    if (seenClarificationFields.has(field)) {
      errors.push(`knowledge_profile_clarification_field_duplicate:${field}`);
      continue;
    }
    seenClarificationFields.add(field);
    const definition = profile.fields[field];
    if (!definition) {
      errors.push(`knowledge_profile_clarification_field_unknown:${field}`);
    } else if (PROHIBITED_CLARIFICATION_FIELDS.has(field)) {
      errors.push(`knowledge_profile_clarification_field_prohibited:${field}`);
    } else if (!CLARIFICATION_FIELD_TYPES.has(definition.type)) {
      errors.push(`knowledge_profile_clarification_field_type_unsupported:${field}`);
    }
  }
  if (profile.relations.some((relation) => !/^[a-z][a-z0-9_]{0,63}$/.test(relation))) {
    errors.push("knowledge_profile_relation_invalid");
  }
  return errors;
}
