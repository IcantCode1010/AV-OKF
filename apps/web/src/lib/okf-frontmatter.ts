import type { TopicRelation } from "./okf-relation-types.ts";

export type OkfFrontmatterValue = string | string[] | OkfFrontmatterObject[];

export type OkfFrontmatterObject = Record<string, string>;

export type ParsedOkfMarkdown = {
  body: string;
  frontmatter: Record<string, OkfFrontmatterValue>;
};

export function parseOkfMarkdown(markdown: string): ParsedOkfMarkdown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);

  if (!match) {
    return { body: markdown, frontmatter: {} };
  }

  return {
    body: markdown.slice(match[0].length).replace(/^\r?\n/, ""),
    frontmatter: parseOkfFrontmatterBlock(match[1] ?? ""),
  };
}

export function getFrontmatterScalar(
  frontmatter: Record<string, OkfFrontmatterValue>,
  key: string,
): string | null {
  const value = frontmatter[key];
  return typeof value === "string" ? value : null;
}

export function getFrontmatterStringArray(
  frontmatter: Record<string, OkfFrontmatterValue>,
  key: string,
): string[] {
  const value = frontmatter[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

export function getFrontmatterNumberArray(
  frontmatter: Record<string, OkfFrontmatterValue>,
  key: string,
): number[] {
  return getFrontmatterStringArray(frontmatter, key)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export function getFrontmatterRelations(
  frontmatter: Record<string, OkfFrontmatterValue>,
): TopicRelation[] {
  const value = frontmatter.relations;
  if (!Array.isArray(value) || !value.every(isFrontmatterObject)) {
    return [];
  }

  return value.map((entry) => ({
    reason: entry.reason ?? "",
    relation: entry.relation ?? "",
    target: entry.target ?? "",
    targetType: entry.target_type ?? null,
  }));
}

function parseOkfFrontmatterBlock(block: string): Record<string, OkfFrontmatterValue> {
  const lines = block.split(/\r?\n/);
  const result: Record<string, OkfFrontmatterValue> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const scalar = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);

    if (!scalar) {
      continue;
    }

    const key = scalar[1]!;
    const rawValue = scalar[2]!;

    if (rawValue.trim().length > 0) {
      result[key] = unquoteYamlScalar(rawValue.trim());
      continue;
    }

    const relationItems = parseRelationItems(lines, index + 1);
    if (relationItems.items.length > 0) {
      result[key] = relationItems.items;
      index = relationItems.endIndex;
      continue;
    }

    const listItems = parseListItems(lines, index + 1);
    result[key] = listItems.items;
    index = listItems.endIndex;
  }

  return result;
}

function parseRelationItems(lines: string[], startIndex: number): {
  endIndex: number;
  items: OkfFrontmatterObject[];
} {
  const items: OkfFrontmatterObject[] = [];
  let current: OkfFrontmatterObject | null = null;
  let index = startIndex;

  for (; index < lines.length; index += 1) {
    const itemStart = /^  -\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(
      lines[index]!,
    );
    const property = /^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[index]!);

    if (itemStart) {
      current = {
        [itemStart[1]!]: unquoteYamlScalar(itemStart[2]!.trim()),
      };
      items.push(current);
      continue;
    }

    if (property && current) {
      current[property[1]!] = unquoteYamlScalar(property[2]!.trim());
      continue;
    }

    break;
  }

  return { endIndex: Math.max(startIndex - 1, index - 1), items };
}

function parseListItems(lines: string[], startIndex: number): {
  endIndex: number;
  items: string[];
} {
  const items: string[] = [];
  let index = startIndex;

  for (; index < lines.length; index += 1) {
    const item = /^  -\s*(.*)$/.exec(lines[index]!);
    if (!item) {
      break;
    }

    items.push(unquoteYamlScalar(item[1]!.trim()));
  }

  return { endIndex: Math.max(startIndex - 1, index - 1), items };
}

function unquoteYamlScalar(value: string): string {
  if (value.length === 0) {
    return "";
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isFrontmatterObject(value: unknown): value is OkfFrontmatterObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
