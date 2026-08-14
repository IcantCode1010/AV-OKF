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
  | "object"
  | "object_array"
  | "relations"
  | "string"
  | "string_array";

export type KnowledgeProfileSchema = {
  okfVersion: "0.1" | "0.2";
  agent: {
    boundedAdaptiveRetryEnabled: boolean;
  };
  automation: {
    autoApproveEnrichedTopics: boolean;
    autoApproveVerifiedRelations: boolean;
  };
  clarificationFields: string[];
  fields: Record<string, { required?: boolean; type: KnowledgeFieldType }>;
  id: string;
  name: string;
  relationDiscovery: {
    stopwords: string[];
  };
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
  "generated",
  "sources",
  "stale_after",
  "status",
  "verified",
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

export const GENERIC_RELATION_DISCOVERY_STOPWORDS = [
  "concept",
  "document",
  "general",
  "information",
  "overview",
  "procedure",
  "system",
] as const;

export const AVIATION_RELATION_DISCOVERY_STOPWORDS = [
  ...GENERIC_RELATION_DISCOVERY_STOPWORDS,
  "aircraft",
  "airplane",
  "flight",
  "manual",
  "operation",
  "operations",
] as const;

export const BASE_FIELDS: KnowledgeProfileSchema["fields"] = {
  type: { required: true, type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  resource: { type: "string" },
  tags: { type: "string_array" },
  sources: { type: "object_array" },
  generated: { type: "object" },
  verified: { type: "object_array" },
  status: { type: "string" },
  stale_after: { type: "date" },
  source_pages: { type: "number_array" },
  knowledge_version: { type: "string" },
  av_okf_approval_mode: { type: "string" },
  av_okf_lifecycle: { type: "string" },
  av_okf_role: { type: "string" },
  relations: { type: "relations" },
  classification_code: { type: "string" },
  coverage_type: { type: "string" },
  covered_rag_chunk_ids: { type: "string_array" },
  document_type: { type: "string" },
  entity_type: { type: "string" },
  effectivity: { type: "string" },
  revision: { type: "string" },
  subject_family: { type: "string" },
};

export const GENERIC_PROFILE_TEMPLATE: KnowledgeProfileSchema = {
  okfVersion: "0.2",
  agent: { boundedAdaptiveRetryEnabled: false },
  automation: {
    autoApproveEnrichedTopics: false,
    autoApproveVerifiedRelations: false,
  },
  clarificationFields: [...DEFAULT_CLARIFICATION_FIELDS],
  fields: BASE_FIELDS,
  id: "generic",
  name: "Generic",
  relationDiscovery: {
    stopwords: [...GENERIC_RELATION_DISCOVERY_STOPWORDS],
  },
  relations: [...DEFAULT_RELATIONS],
  types: {
    concept: { category: "concepts", label: "Concept" },
    entity: { category: "concepts", label: "Entity" },
    metric: { category: "references", label: "Metric" },
    policy: { category: "concepts", label: "Policy" },
    procedure: { category: "procedures", label: "Procedure" },
    reference: { category: "references", label: "Reference" },
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
  relationDiscovery: {
    stopwords: [...AVIATION_RELATION_DISCOVERY_STOPWORDS],
  },
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
  normalized.okfVersion = normalized.okfVersion === "0.2" ? "0.2" : "0.1";
  if (
    ["generic", "aviation"].includes(normalized.id) &&
    !normalized.types.entity
  ) {
    normalized.types.entity = { category: "concepts", label: "Entity" };
  }
  if (
    ["generic", "aviation"].includes(normalized.id) &&
    !normalized.fields.entity_type
  ) {
    normalized.fields.entity_type = { type: "string" };
  }
  normalized.agent = {
    boundedAdaptiveRetryEnabled:
      normalized.agent?.boundedAdaptiveRetryEnabled === true,
  };
  normalized.automation = {
    autoApproveEnrichedTopics:
      normalized.automation?.autoApproveEnrichedTopics === true,
    autoApproveVerifiedRelations:
      normalized.automation?.autoApproveVerifiedRelations === true,
  };
  if (!Array.isArray(normalized.clarificationFields)) {
    normalized.clarificationFields = ["generic", "aviation"].includes(normalized.id)
      ? DEFAULT_CLARIFICATION_FIELDS.filter((field) => Boolean(normalized.fields[field]))
      : [];
  }
  const defaultStopwords = normalized.id === "aviation"
    ? AVIATION_RELATION_DISCOVERY_STOPWORDS
    : GENERIC_RELATION_DISCOVERY_STOPWORDS;
  if (!Array.isArray(normalized.relationDiscovery?.stopwords)) {
    normalized.relationDiscovery = {
      stopwords: [...defaultStopwords],
    };
  } else {
    normalized.relationDiscovery.stopwords = normalizeRelationDiscoveryStopwords(
      normalized.relationDiscovery.stopwords,
    );
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
  if (profile.okfVersion !== "0.2") {
    errors.push("knowledge_profile_okf_v02_required");
  }
  if (typeof profile.agent?.boundedAdaptiveRetryEnabled !== "boolean") {
    errors.push("knowledge_profile_agent_invalid");
  }
  if (
    typeof profile.automation?.autoApproveEnrichedTopics !== "boolean" ||
    typeof profile.automation?.autoApproveVerifiedRelations !== "boolean"
  ) {
    errors.push("knowledge_profile_automation_invalid");
  }
  if (profile.fields.type?.required !== true || profile.fields.type.type !== "string") {
    errors.push("knowledge_profile_type_field_required");
  }
  for (const field of [
    "title",
    "description",
    "resource",
    "tags",
    "sources",
    "generated",
    "verified",
    "status",
    "stale_after",
  ]) {
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
    if (PROHIBITED_CLARIFICATION_FIELDS.has(field)) {
      errors.push(`knowledge_profile_clarification_field_prohibited:${field}`);
    } else if (!definition) {
      errors.push(`knowledge_profile_clarification_field_unknown:${field}`);
    } else if (!CLARIFICATION_FIELD_TYPES.has(definition.type)) {
      errors.push(`knowledge_profile_clarification_field_type_unsupported:${field}`);
    }
  }
  if (profile.relations.some((relation) => !/^[a-z][a-z0-9_]{0,63}$/.test(relation))) {
    errors.push("knowledge_profile_relation_invalid");
  }
  if (!Array.isArray(profile.relationDiscovery?.stopwords)) {
    errors.push("knowledge_profile_relation_discovery_stopwords_invalid");
  } else if (profile.relationDiscovery.stopwords.length > 256) {
    errors.push("knowledge_profile_relation_discovery_stopwords_too_many");
  } else if (
    profile.relationDiscovery.stopwords.some(
      (stopword) =>
        typeof stopword !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stopword),
    )
  ) {
    errors.push("knowledge_profile_relation_discovery_stopword_invalid");
  }
  return errors;
}

export function normalizeRelationDiscoveryStopwords(values: string[]) {
  return [...new Set(
    values
      .map((value) => value.normalize("NFKC").trim().toLowerCase())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}
