import path from "node:path";

import {
  readOkfBundleEvidenceByPath,
  type OkfBundleEvidence,
  type OkfConceptLifecycleLookup,
} from "./okf-bundle-retriever.ts";
export type OkfRelationPath = {
  relationTypes: string[];
  files: string[];
};

export type OkfGraphTraversalResult = {
  concepts: OkfBundleEvidence[];
  paths: OkfRelationPath[];
  warnings: string[];
};

export type OkfGraphTraversalInput = {
  knowledgeRoot?: string;
  lifecycleLookup?: OkfConceptLifecycleLookup;
  maxHops?: number;
  seedFiles: string[];
  workspaceId: string;
};

const DEFAULT_MAX_HOPS = 2;

export async function traverseOkfRelations(
  input: OkfGraphTraversalInput,
): Promise<OkfGraphTraversalResult> {
  const maxHops = Math.max(0, Math.min(input.maxHops ?? DEFAULT_MAX_HOPS, 3));
  const concepts = new Map<string, OkfBundleEvidence>();
  const paths: OkfRelationPath[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();

  for (const seedFile of input.seedFiles) {
    const normalizedSeed = normalizeBundlePath(seedFile);
    if (!normalizedSeed || visited.has(normalizedSeed)) {
      continue;
    }

    const seed = await readOkfBundleEvidenceByPath({
      filePath: normalizedSeed,
      knowledgeRoot: input.knowledgeRoot,
      lifecycleLookup: input.lifecycleLookup,
      workspaceId: input.workspaceId,
    });
    if (!seed) {
      warnings.push(`graph_seed_unavailable:${normalizedSeed}`);
      continue;
    }

    visited.add(normalizedSeed);
    await walk({
      concepts,
      current: seed,
      currentPath: { files: [normalizedSeed], relationTypes: [] },
      input,
      maxHops,
      paths,
      visited,
      warnings,
    });
  }

  return {
    concepts: [...concepts.values()].sort((left, right) =>
      left.filePath.localeCompare(right.filePath),
    ),
    paths,
    warnings,
  };
}

async function walk(input: {
  concepts: Map<string, OkfBundleEvidence>;
  current: OkfBundleEvidence;
  currentPath: OkfRelationPath;
  input: OkfGraphTraversalInput;
  maxHops: number;
  paths: OkfRelationPath[];
  visited: Set<string>;
  warnings: string[];
}): Promise<void> {
  if (input.currentPath.relationTypes.length >= input.maxHops) {
    return;
  }

  for (let index = 0; index < input.current.relations.length; index += 1) {
    const relation = input.current.relations[index]!;
    const target = resolveRelationTarget(input.current.filePath, relation.target);

    if (!target) {
      input.warnings.push(
        `graph_relation_target_invalid:${input.current.filePath}:${index}`,
      );
      continue;
    }

    if (input.visited.has(target)) {
      input.warnings.push(`graph_cycle_skipped:${target}`);
      continue;
    }

    const concept = await readOkfBundleEvidenceByPath({
      filePath: target,
      knowledgeRoot: input.input.knowledgeRoot,
      lifecycleLookup: input.input.lifecycleLookup,
      workspaceId: input.input.workspaceId,
    });
    if (!concept) {
      input.warnings.push(`graph_relation_target_unavailable:${target}`);
      continue;
    }

    if (relation.targetType && relation.targetType !== concept.type) {
      input.warnings.push(
        `graph_relation_target_type_mismatch:${input.current.filePath}:${index}`,
      );
      continue;
    }

    const nextPath: OkfRelationPath = {
      files: [...input.currentPath.files, target],
      relationTypes: [...input.currentPath.relationTypes, relation.relation],
    };
    input.paths.push(nextPath);
    input.concepts.set(target, concept);
    input.visited.add(target);

    await walk({
      ...input,
      current: concept,
      currentPath: nextPath,
    });
  }
}

function resolveRelationTarget(sourceFile: string, target: string): string | null {
  const normalizedTarget = normalizeBundlePath(target);
  if (!normalizedTarget || !normalizedTarget.endsWith(".md")) {
    return null;
  }

  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourceFile), normalizedTarget),
  );
  if (resolved.startsWith("../") || resolved === ".." || resolved.startsWith("/")) {
    return null;
  }

  return resolved;
}

function normalizeBundlePath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  return normalized && !normalized.startsWith("/") ? normalized : null;
}
