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
  fields: Record<string, { required?: boolean; type: KnowledgeFieldType }>;
  id: string;
  name: string;
  relations: string[];
  types: Record<string, { category: KnowledgeFolderCategory; label: string }>;
};

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

export function getTypeDirectory(profile: KnowledgeProfileSchema, type: string): string {
  const definition = profile.types[type];
  if (!definition) throw new Error(`knowledge_profile_type_not_allowed:${type}`);
  return `${definition.category}/${type.replaceAll("_", "-")}`;
}

export function validateKnowledgeProfile(profile: KnowledgeProfileSchema): string[] {
  const errors: string[] = [];
  if (profile.fields.type?.required !== true || profile.fields.type.type !== "string") {
    errors.push("knowledge_profile_type_field_required");
  }
  for (const field of ["title", "description", "tags", "updated"]) {
    if (!profile.fields[field]) errors.push(`knowledge_profile_base_field_missing:${field}`);
  }
  if (Object.keys(profile.types).length === 0) errors.push("knowledge_profile_types_required");
  if (profile.relations.some((relation) => !/^[a-z][a-z0-9_]{0,63}$/.test(relation))) {
    errors.push("knowledge_profile_relation_invalid");
  }
  return errors;
}
