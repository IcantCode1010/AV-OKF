import { buildIncomingOkfIndex, resolveGraphTarget } from "./okf-graph-index.ts";

import {
  readOkfBundleEvidenceByPath,
  type OkfBundleEvidence,
  type OkfConceptLifecycleLookup,
} from "./okf-bundle-retriever.ts";
export type OkfRelationPath = {
  relationTypes: string[];
  files: string[];
  directions?: Array<"outgoing" | "incoming">;
};

export type OkfGraphTraversalResult = {
  inspectedFiles?: string[];
  concepts: OkfBundleEvidence[];
  paths: OkfRelationPath[];
  warnings: string[];
};

export type OkfGraphTraversalInput = {
  knowledgeBundleId: string;
  knowledgeRoot?: string;
  lifecycleLookup?: OkfConceptLifecycleLookup;
  maxHops?: number;
  maxNodes?: number;
  maxEdges?: number;
  direction?: "outgoing" | "incoming" | "both";
  relationTypes?: string[];
  maxIndexFiles?: number;
  maxMilliseconds?: number;
  allowedFiles?: string[];
  seedFiles: string[];
  workspaceId: string;
};

const DEFAULT_MAX_HOPS = 2;

export async function traverseOkfRelations(
  input: OkfGraphTraversalInput,
): Promise<OkfGraphTraversalResult> {
  const maxHops = input.maxHops !== undefined && Number.isFinite(input.maxHops)
    ? Math.max(0, Math.min(Math.floor(input.maxHops), 3))
    : DEFAULT_MAX_HOPS;
  const concepts = new Map<string, OkfBundleEvidence>();
  const paths: OkfRelationPath[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();
  const maxNodes = boundedInteger(input.maxNodes, 100, 1000);
  const maxEdges = boundedInteger(input.maxEdges, 500, 5000);
  const queue: Array<{ current: OkfBundleEvidence; currentPath: OkfRelationPath }> = [];
  const cache = new Map<string, OkfBundleEvidence | null>();
  const deadline = Date.now() + boundedInteger(input.maxMilliseconds, 5000, 30000);
  const direction = input.direction ?? "outgoing";
  const allowed = input.allowedFiles ? new Set(input.allowedFiles) : null;

  for (const seedFile of input.seedFiles) {
    if (Date.now() >= deadline) { warnings.push("graph_time_budget_exhausted"); break; }
    const normalizedSeed = normalizeBundlePath(seedFile);
    if (!normalizedSeed || visited.has(normalizedSeed)) {
      continue;
    }
    if (allowed && !allowed.has(normalizedSeed)) { warnings.push("graph_seed_outside_scope"); continue; }
    if (visited.size >= maxNodes) {
      warnings.push("graph_node_budget_exhausted");
      break;
    }

    const seed = await readOkfBundleEvidenceByPath({
      filePath: normalizedSeed,
      knowledgeBundleId: input.knowledgeBundleId,
      knowledgeRoot: input.knowledgeRoot,
      lifecycleLookup: input.lifecycleLookup,
      workspaceId: input.workspaceId,
    });
    if (!seed) {
      warnings.push(`graph_seed_unavailable:${normalizedSeed}`);
      continue;
    }

    visited.add(normalizedSeed);
    cache.set(normalizedSeed, seed);
    queue.push({ current: seed, currentPath: { files: [normalizedSeed], relationTypes: [] } });
  }

  // Reverse discovery must not consume the entire traversal budget or scan a
  // bundle when none of the requested starting concepts are accessible.
  const indexDeadline = Date.now() + Math.max(0, Math.floor((deadline - Date.now()) / 2));
  const incoming = direction === "outgoing" || maxHops === 0 || queue.length === 0 ? null
    : await buildIncomingOkfIndex(input, indexDeadline, boundedInteger(input.maxIndexFiles, 500, 5000));
  if (incoming) warnings.push(...incoming.warnings);

  // Seed the entire frontier before expansion: each node is expanded at its
  // shortest distance from any seed, independent of relation ordering.
  let examinedEdges = 0;
  traversal: for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (Date.now() >= deadline) { warnings.push("graph_time_budget_exhausted"); break; }
    const { current, currentPath } = queue[cursor]!;
    if (currentPath.relationTypes.length >= maxHops) continue;
    const candidates = [
      ...(direction === "incoming" ? [] : current.relations.map((relation) => ({
        ...relation, nextFile: resolveGraphTarget(current.filePath, relation.target), direction: "outgoing" as const,
      }))),
      ...(incoming?.incoming.get(current.filePath) ?? []).map((link) => ({
        ...link, nextFile: link.sourceFile, direction: "incoming" as const,
      })),
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      if (Date.now() >= deadline) { warnings.push("graph_time_budget_exhausted"); break traversal; }
      if (examinedEdges++ >= maxEdges) {
        warnings.push("graph_edge_budget_exhausted");
        break traversal;
      }
      const relation = candidates[index]!;
      if (input.relationTypes?.length && !input.relationTypes.includes(relation.relation)) continue;
      const target = relation.nextFile;
      if (!target) {
        warnings.push(`graph_relation_target_invalid:${current.filePath}:${index}`);
        continue;
      }
      if (allowed && !allowed.has(target)) { warnings.push("graph_target_outside_scope"); continue; }
      if (currentPath.files.includes(target)) {
        warnings.push(`graph_cycle_skipped:${target}`);
        continue;
      }
      if (!cache.has(target)) {
        if (cache.size >= maxNodes) {
          warnings.push("graph_node_budget_exhausted");
          continue;
        }
        cache.set(target, await readOkfBundleEvidenceByPath({
          filePath: target,
          knowledgeBundleId: input.knowledgeBundleId,
          knowledgeRoot: input.knowledgeRoot,
          lifecycleLookup: input.lifecycleLookup,
          workspaceId: input.workspaceId,
        }));
      }
      const concept = cache.get(target);
      if (!concept) {
        warnings.push(`graph_relation_target_unavailable:${target}`);
        continue;
      }
      if (relation.direction === "incoming" && !concept.relations.some((edge) =>
        edge.relation === relation.relation && resolveGraphTarget(concept.filePath, edge.target) === current.filePath,
      )) {
        warnings.push(`graph_relation_changed:${concept.filePath}`);
        continue;
      }
      if (relation.targetType && relation.targetType !== (relation.direction === "incoming" ? current.type : concept.type)) {
        warnings.push(`graph_relation_target_type_mismatch:${current.filePath}:${index}`);
        continue;
      }
      const nextPath = {
        files: [...currentPath.files, target],
        relationTypes: [...currentPath.relationTypes, relation.relation],
        ...(direction !== "outgoing" ? { directions: [...(currentPath.directions ?? []), relation.direction] } : {}),
      };
      paths.push(nextPath);
      concepts.set(target, concept);
      if (!visited.has(target)) {
        visited.add(target);
        queue.push({ current: concept, currentPath: nextPath });
      }
    }
  }

  return {
    inspectedFiles: [...cache.entries()].filter(([, value]) => value !== null).map(([file]) => file).sort(),
    concepts: [...concepts.values()].sort((left, right) =>
      left.filePath.localeCompare(right.filePath),
    ),
    paths,
    warnings: [...new Set(warnings)],
  };
}

function boundedInteger(value: number | undefined, fallback: number, ceiling: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.min(Math.floor(value), ceiling));
}

function normalizeBundlePath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  return normalized && !normalized.startsWith("/") ? normalized : null;
}
