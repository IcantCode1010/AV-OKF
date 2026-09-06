import type { OkfSource } from "./okf-frontmatter.ts";

export type OkfV02ClaimAttributionIssue = {
  code:
    | "okf_v02_claim_footnote_definition_duplicate"
    | "okf_v02_claim_footnote_definition_missing"
    | "okf_v02_claim_source_id_duplicate"
    | "okf_v02_claim_source_missing";
  label: string;
  message: string;
};

export type OkfV02ClaimAttribution = {
  definitions: string[];
  issues: OkfV02ClaimAttributionIssue[];
  matchedReferenceCount: number;
  references: string[];
  sourceIds: string[];
};

export function inspectOkfV02ClaimAttribution(input: {
  body: string;
  sources: OkfSource[];
}): OkfV02ClaimAttribution {
  const sourceIds = input.sources.flatMap((source) => source.id ? [source.id.trim()] : []);
  const parsed = parseFootnotes(input.body);
  const sourceIdSet = new Set(sourceIds);
  const definitionSet = new Set(parsed.definitions);
  const sourceIdCounts = counts(sourceIds);
  const definitionCounts = counts(parsed.definitions);
  const issues: OkfV02ClaimAttributionIssue[] = [];

  for (const label of duplicates(sourceIds)) {
    issues.push({
      code: "okf_v02_claim_source_id_duplicate",
      label,
      message: `Source id is declared more than once: ${label}`,
    });
  }
  for (const label of duplicates(parsed.definitions)) {
    issues.push({
      code: "okf_v02_claim_footnote_definition_duplicate",
      label,
      message: `Footnote definition is declared more than once: ${label}`,
    });
  }
  for (const label of unique(parsed.references)) {
    if (!sourceIdSet.has(label)) {
      issues.push({
        code: "okf_v02_claim_source_missing",
        label,
        message: `Claim footnote does not match a sources[].id: ${label}`,
      });
    }
    if (!definitionSet.has(label)) {
      issues.push({
        code: "okf_v02_claim_footnote_definition_missing",
        label,
        message: `Claim footnote has no Markdown definition: ${label}`,
      });
    }
  }
  for (const label of unique(parsed.definitions)) {
    if (!sourceIdSet.has(label) && !parsed.references.includes(label)) {
      issues.push({
        code: "okf_v02_claim_source_missing",
        label,
        message: `Footnote definition does not match a sources[].id: ${label}`,
      });
    }
  }

  return {
    definitions: unique(parsed.definitions),
    issues: issues.sort((left, right) =>
      left.code.localeCompare(right.code) || left.label.localeCompare(right.label)
    ),
    matchedReferenceCount: parsed.references.filter((label) =>
      sourceIdCounts.get(label) === 1 && definitionCounts.get(label) === 1
    ).length,
    references: [...parsed.references],
    sourceIds: unique(sourceIds),
  };
}

function parseFootnotes(body: string) {
  const definitions: string[] = [];
  const references: string[] = [];
  let fence: { character: string; length: number } | null = null;

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const closingFence = new RegExp(
        `^ {0,3}\\${fence.character}{${fence.length},}[ \\t]*$`,
      );
      if (closingFence.test(line)) {
        fence = null;
      }
      continue;
    }
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      fence = { character: fenceMatch[1][0]!, length: fenceMatch[1].length };
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;

    const definition = /^ {0,3}\[\^([^\]\r\n]+)\]:/.exec(line);
    const definitionLabel = definition?.[1]?.trim();
    if (definitionLabel) definitions.push(definitionLabel);

    const searchable = stripInlineCode(
      definition ? line.slice(definition[0].length) : line,
    );
    for (const match of searchable.matchAll(/\[\^([^\]\r\n]+)\]/g)) {
      if (match.index !== undefined && isEscaped(searchable, match.index)) continue;
      const label = match[1]?.trim();
      if (label) references.push(label);
    }
  }

  return { definitions, references };
}

function stripInlineCode(line: string) {
  let output = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      output += line[index];
      index += 1;
      continue;
    }

    const start = index;
    while (line[index] === "`") index += 1;
    const delimiter = line.slice(start, index);
    const close = line.indexOf(delimiter, index);
    if (close === -1) {
      output += delimiter;
      continue;
    }
    output += " ".repeat(close + delimiter.length - start);
    index = close + delimiter.length;
  }
  return output;
}

function isEscaped(value: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function duplicates(values: string[]) {
  return [...counts(values)]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function counts(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
