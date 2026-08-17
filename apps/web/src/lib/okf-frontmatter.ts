import { isAlias, parseDocument, stringify } from "yaml";

import type { TopicRelation } from "./okf-relation-types.ts";

export type OkfFrontmatterValue = unknown;
export type OkfFrontmatterObject = Record<string, unknown>;

export type OkfActorEvent = {
  at?: string;
  by: string;
};

export type OkfSource = {
  author?: string;
  id?: string;
  last_modified?: string;
  resource: string;
  title?: string;
  usage_count?: number;
  usage_window?: { from: string; to: string };
};

export type OkfV02Frontmatter = Record<string, unknown> & {
  description?: string;
  generated?: OkfActorEvent;
  resource?: string;
  sources?: OkfSource[];
  stale_after?: string;
  status?: "deprecated" | "draft" | "stable";
  tags?: string[];
  title?: string;
  type?: string;
  verified?: OkfActorEvent[] | OkfActorEvent;
};

export type ParsedOkfMarkdown = {
  body: string;
  frontmatter: OkfV02Frontmatter;
};

export type OkfTrustTier =
  | "human_reviewed"
  | "machine_confirmed"
  | "unverified";

export type OkfApprovalProvenance = "automated" | "human" | "legacy";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/;

export function parseOkfMarkdown(markdown: string): ParsedOkfMarkdown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);

  if (!match) {
    return { body: markdown, frontmatter: {} };
  }

  const document = parseDocument(match[1] ?? "", {
    prettyErrors: false,
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`okf_frontmatter_invalid:${document.errors[0]!.message}`);
  }
  if (document.contents && hasAlias(document.contents)) {
    throw new Error("okf_frontmatter_alias_not_allowed");
  }

  const value = document.toJS({ maxAliasCount: 0 });
  if (!isPlainObject(value)) {
    throw new Error("okf_frontmatter_must_be_mapping");
  }

  return {
    body: markdown.slice(match[0].length).replace(/^\r?\n/, ""),
    frontmatter: value,
  };
}

export function serializeOkfMarkdown(input: {
  body: string;
  frontmatter: OkfV02Frontmatter;
}): string {
  const frontmatter = stringify(input.frontmatter, {
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
  const body = input.body
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
  return body
    ? `---\n${frontmatter}\n---\n\n${body}\n`
    : `---\n${frontmatter}\n---\n`;
}

export function getFrontmatterScalar(
  frontmatter: Record<string, unknown>,
  key: string,
): string | null {
  const value = frontmatter[key];
  return typeof value === "string" ? value : null;
}

export function getFrontmatterStringArray(
  frontmatter: Record<string, unknown>,
  key: string,
): string[] {
  const value = frontmatter[key];
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
    ? value.map(String)
    : [];
}

export function getFrontmatterNumberArray(
  frontmatter: Record<string, unknown>,
  key: string,
): number[] {
  const value = frontmatter[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
}

export function getFrontmatterRelations(
  frontmatter: Record<string, unknown>,
): TopicRelation[] {
  const value = frontmatter.relations;
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const relation = asString(entry.relation);
    const target = asString(entry.target);
    if (!relation || !target) return [];
    return [{
      ...(
        entry.av_okf_approval_mode === "automated" ||
          entry.av_okf_approval_mode === "human"
          ? { approvalMode: entry.av_okf_approval_mode }
          : {}
      ),
      reason: asString(entry.reason) ?? "",
      relation,
      target,
      targetType: asString(entry.target_type),
      ...(
        typeof entry.verification_confidence === "number"
          ? { verificationConfidence: entry.verification_confidence }
          : {}
      ),
    }];
  });
}

export function getFrontmatterSources(
  frontmatter: Record<string, unknown>,
): OkfSource[] {
  const value = frontmatter.sources;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const resource = asString(entry.resource);
    if (!resource) return [];
    const usageWindow = isPlainObject(entry.usage_window)
      ? {
          from: asString(entry.usage_window.from) ?? "",
          to: asString(entry.usage_window.to) ?? "",
        }
      : undefined;
    return [{
      ...(asString(entry.author) ? { author: asString(entry.author)! } : {}),
      ...(asString(entry.id) ? { id: asString(entry.id)! } : {}),
      ...(asString(entry.last_modified)
        ? { last_modified: asString(entry.last_modified)! }
        : {}),
      resource,
      ...(asString(entry.title) ? { title: asString(entry.title)! } : {}),
      ...(typeof entry.usage_count === "number"
        ? { usage_count: entry.usage_count }
        : {}),
      ...(usageWindow?.from && usageWindow.to
        ? { usage_window: usageWindow }
        : {}),
    }];
  });
}

export function getFrontmatterVerificationEvents(
  frontmatter: Record<string, unknown>,
): OkfActorEvent[] {
  const value = frontmatter.verified;
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const by = asString(entry.by);
    if (!by) return [];
    const at = asString(entry.at);
    return [{ by, ...(at ? { at } : {}) }];
  });
}

export function getFrontmatterGeneratedEvent(
  frontmatter: Record<string, unknown>,
): OkfActorEvent | null {
  const value = frontmatter.generated;
  if (!isPlainObject(value)) return null;
  const by = asString(value.by);
  if (!by) return null;
  const at = asString(value.at);
  return { by, ...(at ? { at } : {}) };
}

export function deriveOkfTrustTier(
  frontmatter: Record<string, unknown>,
): OkfTrustTier {
  const events = getFrontmatterVerificationEvents(frontmatter);
  if (events.some((event) => event.by.startsWith("human:"))) {
    return "human_reviewed";
  }
  return events.length > 0 ? "machine_confirmed" : "unverified";
}

export function getOkfApprovalProvenance(
  frontmatter: Record<string, unknown>,
): OkfApprovalProvenance {
  const mode = getFrontmatterScalar(frontmatter, "av_okf_approval_mode");
  if (mode === "legacy") return "legacy";
  const events = getFrontmatterVerificationEvents(frontmatter);
  if (events.some((event) => event.by.startsWith("human:"))) return "human";
  if (events.some((event) => event.by === "process:av-okf-auto-approval")) {
    return "automated";
  }
  return "legacy";
}

export function getOkfPrimarySource(
  frontmatter: Record<string, unknown>,
): OkfSource | null {
  return getFrontmatterSources(frontmatter)[0] ?? null;
}

export function isOkfV02Current(
  frontmatter: Record<string, unknown>,
  today = new Date(),
): boolean {
  if (frontmatter.status !== "stable") return false;
  const staleAfter = asString(frontmatter.stale_after);
  if (!staleAfter) return true;
  return today.toISOString().slice(0, 10) < staleAfter;
}

export function validateOkfV02Frontmatter(
  frontmatter: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  if (!asString(frontmatter.type)) errors.push("okf_v02_type_required");
  for (const key of ["title", "description", "resource"] as const) {
    if (frontmatter[key] !== undefined && !asString(frontmatter[key])) {
      errors.push(`okf_v02_${key}_invalid`);
    }
  }
  if (
    frontmatter.tags !== undefined &&
    (!Array.isArray(frontmatter.tags) ||
      !frontmatter.tags.every((tag) => Boolean(asString(tag))))
  ) {
    errors.push("okf_v02_tags_invalid");
  }
  if (frontmatter.status !== undefined &&
      !["draft", "stable", "deprecated"].includes(String(frontmatter.status))) {
    errors.push("okf_v02_status_invalid");
  }
  if (frontmatter.stale_after !== undefined &&
      !isIsoDate(asString(frontmatter.stale_after))) {
    errors.push("okf_v02_stale_after_invalid");
  }
  if (frontmatter.generated !== undefined) {
    if (!isPlainObject(frontmatter.generated) ||
        !asString(frontmatter.generated.by) ||
        (frontmatter.generated.at !== undefined &&
          !isIsoDateTime(asString(frontmatter.generated.at)))) {
      errors.push("okf_v02_generated_invalid");
    }
  }
  if (frontmatter.verified !== undefined) {
    const raw = Array.isArray(frontmatter.verified)
      ? frontmatter.verified
      : [frontmatter.verified];
    if (raw.length === 0 || raw.some((entry) =>
      !isPlainObject(entry) ||
      !asString(entry.by) ||
      !isIsoDateTime(asString(entry.at)))) {
      errors.push("okf_v02_verified_invalid");
    }
  }
  if (frontmatter.sources !== undefined) {
    if (!Array.isArray(frontmatter.sources) ||
        frontmatter.sources.some((entry) =>
          !isPlainObject(entry) || !asString(entry.resource))) {
      errors.push("okf_v02_sources_invalid");
    }
  }
  return errors;
}

function hasAlias(node: unknown): boolean {
  if (isAlias(node)) return true;
  if (!node || typeof node !== "object") return false;
  if ("items" in node && Array.isArray((node as { items?: unknown[] }).items)) {
    return (node as { items: unknown[] }).items.some(hasAlias);
  }
  if ("key" in node || "value" in node) {
    const pair = node as { key?: unknown; value?: unknown };
    return hasAlias(pair.key) || hasAlias(pair.value);
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isIsoDate(value: string | null): boolean {
  if (!value || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: string | null): boolean {
  return Boolean(value && ISO_DATE_TIME_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).valueOf()));
}
