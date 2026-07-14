import { readFile } from "node:fs/promises";
import path from "node:path";

import { getFrontmatterScalar, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
export { getAllowedRelations } from "./okf-relation-vocabulary.ts";
import { getAllowedRelations } from "./okf-relation-vocabulary.ts";
export { normalizeTopicRelations } from "./okf-relation-types.ts";
export type { TopicRelation } from "./okf-relation-types.ts";
import type { TopicRelation } from "./okf-relation-types.ts";

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

    const targetPath = await resolveRelationTarget(relation.target, root);
    if (!targetPath) {
      throwViolation(index, "relation_target_invalid");
    }

    let targetContent = "";
    try {
      targetContent = await readFile(
        /*turbopackIgnore: true*/ targetPath,
        "utf8",
      );
    } catch (error) {
      if (isMissingFileError(error)) {
        throwViolation(index, "relation_target_missing");
      }

      throw error;
    }

    const actualType = getFrontmatterScalar(
      parseOkfMarkdown(targetContent).frontmatter,
      "type",
    );
    if (!relation.targetType || relation.targetType !== actualType) {
      throwViolation(index, "relation_target_type_mismatch");
    }

    if (relation.reason.trim().length === 0) {
      throwViolation(index, "relation_reason_required");
    }
  }
}

async function resolveRelationTarget(target: string, root: string) {
  if (
    target.trim().length === 0 ||
    target.includes("\\") ||
    target.includes("?") ||
    path.isAbsolute(target) ||
    !target.endsWith(".md")
  ) {
    return null;
  }

  return resolveKnowledgePath({
    knowledgeRoot: root,
    relativePath: target,
  });
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
