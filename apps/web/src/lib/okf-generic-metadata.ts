import {
  deriveOkfTrustTier,
  getFrontmatterSources,
  isOkfV02Current,
  validateOkfV02Frontmatter,
} from "./okf-frontmatter.ts";

export const GENERIC_OKF_FIELD_NAMES = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
] as const;

export type GenericOkfMetadata = {
  description?: string;
  resource?: string;
  tags?: string[];
  title?: string;
  type: string;
};

export type GenericOkfMetadataValidation =
  | { metadata: GenericOkfMetadata; valid: true }
  | { errors: string[]; valid: false };

export function validateGenericOkfMetadata(
  value: Record<string, unknown>,
): GenericOkfMetadataValidation {
  const errors: string[] = [];
  const type = normalizeOptionalString(value.type);
  const title = normalizeOptionalString(value.title);
  const description = normalizeOptionalString(value.description);
  const resource = normalizeOptionalString(value.resource);
  const tags = normalizeTags(value.tags, errors);

  if (!type) {
    errors.push("generic_okf_type_required");
  }

  if (value.title !== undefined && !title) {
    errors.push("generic_okf_title_invalid");
  }

  if (value.description !== undefined && !description) {
    errors.push("generic_okf_description_invalid");
  }

  errors.push(...validateOkfV02Frontmatter(value).filter(
    (error) => !["okf_v02_type_required", "okf_v02_tags_invalid"].includes(error),
  ));

  if (errors.length > 0 || !type) {
    return { errors, valid: false };
  }

  return {
    metadata: {
      ...(description ? { description } : {}),
      ...(resource ? { resource } : {}),
      ...(tags ? { tags } : {}),
      ...(title ? { title } : {}),
      type,
    },
    valid: true,
  };
}

export function isAgentReadyOkfMetadata(
  value: Record<string, unknown>,
  body: string,
): boolean {
  const generic = validateGenericOkfMetadata(value);
  const title = normalizeOptionalString(value.title);
  const sourcePages = value.source_pages;
  const sources = getFrontmatterSources(value);

  return (
    generic.valid &&
    isOkfV02Current(value) &&
    deriveOkfTrustTier(value) !== "unverified" &&
    value.av_okf_role !== "source_document" &&
    Boolean(title) &&
    body.trim().length > 0 &&
    sources.length > 0 &&
    Array.isArray(sourcePages) &&
    sourcePages.length > 0 &&
    sourcePages.every((page) => {
      const numeric = typeof page === "string" ? Number(page) : page;
      return Number.isInteger(numeric) && Number(numeric) > 0;
    })
  );
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeTags(value: unknown, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push("generic_okf_tags_invalid");
    return undefined;
  }

  const tags = value.map(normalizeOptionalString);
  if (tags.some((tag) => !tag)) {
    errors.push("generic_okf_tags_invalid");
    return undefined;
  }

  return [...new Set(tags as string[])];
}
