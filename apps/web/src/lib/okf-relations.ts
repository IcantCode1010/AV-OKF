import { readFile } from "node:fs/promises";
import path from "node:path";

export type TopicRelation = {
  relation: string;
  target: string;
  targetType: string | null;
  reason: string;
};

export type RelationValidationViolation = {
  code:
    | "relation_type_not_allowed"
    | "relation_target_invalid"
    | "relation_target_missing"
    | "relation_target_type_mismatch"
    | "relation_reason_required";
  index: number;
  message: string;
};

export class RelationValidationError extends Error {
  readonly violation: RelationValidationViolation;

  constructor(violation: RelationValidationViolation) {
    super(`${violation.code}: relation ${violation.index}`);
    this.name = "RelationValidationError";
    this.violation = violation;
  }
}

export async function getAllowedRelations(
  manifestPath = path.join(process.cwd(), "..", "..", "okf-base.yaml"),
): Promise<string[]> {
  const manifest = await readFile(manifestPath, "utf8");
  const lines = manifest.split(/\r?\n/);
  const relationsIndex = lines.findIndex((line) => line.trim() === "relations:");
  const allowedIndex = lines.findIndex(
    (line, index) => index > relationsIndex && line.trim() === "allowed:",
  );
  const allowed: string[] = [];

  for (const line of lines.slice(allowedIndex + 1)) {
    if (!line.startsWith("  - ")) {
      break;
    }

    allowed.push(line.trim().slice(2).trim());
  }

  if (relationsIndex === -1 || allowedIndex === -1 || allowed.length === 0) {
    throw new Error("missing_allowed_relations");
  }

  return allowed;
}

export async function validateTopicRelations(
  relations: TopicRelation[],
  knowledgeRoot: string,
): Promise<void> {
  const allowed = new Set(await getAllowedRelations());
  const root = path.resolve(knowledgeRoot);

  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index]!;

    if (!allowed.has(relation.relation)) {
      throwViolation(index, "relation_type_not_allowed");
    }

    const targetPath = resolveRelationTarget(relation.target, root);
    if (!targetPath) {
      throwViolation(index, "relation_target_invalid");
    }

    let targetContent = "";
    try {
      targetContent = await readFile(targetPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        throwViolation(index, "relation_target_missing");
      }

      throw error;
    }

    const actualType = readFrontmatterScalar(targetContent, "type");
    if (!relation.targetType || relation.targetType !== actualType) {
      throwViolation(index, "relation_target_type_mismatch");
    }

    if (relation.reason.trim().length === 0) {
      throwViolation(index, "relation_reason_required");
    }
  }
}

export function normalizeTopicRelations(value: unknown): TopicRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<Record<keyof TopicRelation, unknown>>;
      return {
        relation: typeof candidate.relation === "string" ? candidate.relation : "",
        target: typeof candidate.target === "string" ? candidate.target : "",
        targetType:
          typeof candidate.targetType === "string" ? candidate.targetType : null,
        reason: typeof candidate.reason === "string" ? candidate.reason : "",
      };
    })
    .filter((entry): entry is TopicRelation => entry !== null);
}

function resolveRelationTarget(target: string, root: string) {
  if (
    target.trim().length === 0 ||
    target.includes("\\") ||
    target.includes("?") ||
    path.isAbsolute(target) ||
    !target.endsWith(".md")
  ) {
    return null;
  }

  const resolved = path.resolve(root, target);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function readFrontmatterScalar(markdown: string, key: string) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1] ?? "";
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(frontmatter);
  return match?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

function throwViolation(
  index: number,
  code: RelationValidationViolation["code"],
): never {
  throw new RelationValidationError({
    code,
    index,
    message: `${code}: relation ${index}`,
  });
}

function isMissingFileError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
