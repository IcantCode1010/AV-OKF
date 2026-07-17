export const GENERIC_OKF_FIELD_NAMES = [
  "type",
  "title",
  "description",
  "tags",
  "updated",
] as const;

export type GenericOkfMetadata = {
  description?: string;
  tags?: string[];
  title?: string;
  type: string;
  updated?: string;
};

export type GenericOkfMetadataValidation =
  | { metadata: GenericOkfMetadata; valid: true }
  | { errors: string[]; valid: false };

const TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateGenericOkfMetadata(
  value: Record<string, unknown>,
): GenericOkfMetadataValidation {
  const errors: string[] = [];
  const type = normalizeOptionalString(value.type);
  const title = normalizeOptionalString(value.title);
  const description = normalizeOptionalString(value.description);
  const updated = normalizeOptionalString(value.updated);
  const tags = normalizeTags(value.tags, errors);

  if (!type) {
    errors.push("generic_okf_type_required");
  } else if (!TYPE_PATTERN.test(type)) {
    errors.push("generic_okf_type_invalid");
  }

  if (value.title !== undefined && !title) {
    errors.push("generic_okf_title_invalid");
  }

  if (value.description !== undefined && !description) {
    errors.push("generic_okf_description_invalid");
  }

  if (updated && (!ISO_DATE_PATTERN.test(updated) || !isRealIsoDate(updated))) {
    errors.push("generic_okf_updated_invalid");
  }

  if (errors.length > 0 || !type) {
    return { errors, valid: false };
  }

  return {
    metadata: {
      ...(description ? { description } : {}),
      ...(tags ? { tags } : {}),
      ...(title ? { title } : {}),
      type,
      ...(updated ? { updated } : {}),
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
  const sourceFile = normalizeOptionalString(value.source_file);
  const sourcePages = value.source_pages;

  return (
    generic.valid &&
    value.review_status === "approved" &&
    Boolean(title) &&
    body.trim().length > 0 &&
    Boolean(sourceFile) &&
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

function isRealIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
