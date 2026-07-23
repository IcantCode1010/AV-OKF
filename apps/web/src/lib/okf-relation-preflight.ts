import path from "node:path";

import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { loadOkfExplorerSnapshot } from "./okf-explorer.ts";
import { getPrisma } from "./prisma.ts";

export type OkfRelationGraphEdge = {
  relation: string;
  sourceFile: string;
  targetFile: string;
};

export type OkfRelationGraphFile = {
  filePath: string;
  type: string;
};

export type OkfRelationPreflightIssue = {
  code:
    | "relation_competing_supersedes"
    | "relation_cycle_detected"
    | "relation_exact_duplicate"
    | "relation_reason_required"
    | "relation_reverse_direction_conflict"
    | "relation_reverse_direction_warning"
    | "relation_reverse_duplicate"
    | "relation_self_link"
    | "relation_source_missing"
    | "relation_target_invalid"
    | "relation_target_missing"
    | "relation_target_type_mismatch"
    | "relation_type_not_allowed";
  message: string;
  severity: "error" | "warning";
};

export type OkfRelationPreflightContext = {
  activeFiles: OkfRelationGraphFile[];
  allowedRelations: string[];
  existingEdges: OkfRelationGraphEdge[];
};

export function resolveRelationDirectionReview(input: {
  currentCandidateId: string;
  selectedCandidate: { id: string; status: string } | null;
}): "conflict" | "reuse_rejected" | "update_current" {
  if (!input.selectedCandidate || input.selectedCandidate.id === input.currentCandidateId) {
    return "update_current";
  }
  return input.selectedCandidate.status === "rejected" ? "reuse_rejected" : "conflict";
}

const ACYCLIC_RELATIONS = new Set(["depends_on", "routes_to", "supersedes"]);
const REVERSE_ALLOWED_WITH_WARNING = new Set(["references", "supports"]);
const SYMMETRIC_RELATIONS = new Set(["conflicts_with"]);

export function preflightOkfRelationCandidate(input: {
  activeFiles: OkfRelationGraphFile[];
  allowedRelations: string[];
  candidate: OkfRelationGraphEdge & {
    reason?: string;
    targetType?: string | null;
  };
  existingEdges: OkfRelationGraphEdge[];
}): { accepted: boolean; issues: OkfRelationPreflightIssue[] } {
  const issues: OkfRelationPreflightIssue[] = [];
  const candidate = normalizeEdge(input.candidate);
  const activeFiles = new Map(input.activeFiles.map((file) => [file.filePath, file]));

  if (!input.allowedRelations.includes(candidate.relation)) {
    issues.push(error("relation_type_not_allowed", `Relation type ${candidate.relation || "<empty>"} is not allowed by the active bundle profile.`));
  }
  if (!isSafeBundleMarkdownPath(candidate.sourceFile)) {
    issues.push(error("relation_target_invalid", "The relation source path is unsafe or invalid."));
  }
  if (!isSafeBundleMarkdownPath(candidate.targetFile)) {
    issues.push(error("relation_target_invalid", "The relation target path is unsafe or invalid."));
  }
  if (candidate.sourceFile === candidate.targetFile) {
    issues.push(error("relation_self_link", "A concept cannot relate to itself."));
  }

  const source = activeFiles.get(candidate.sourceFile);
  const target = activeFiles.get(candidate.targetFile);
  if (!source) {
    issues.push(error("relation_source_missing", "The source concept is missing or inactive in this bundle."));
  }
  if (!target) {
    issues.push(error("relation_target_missing", "The target concept is missing or inactive in this bundle."));
  } else if (input.candidate.targetType && input.candidate.targetType !== target.type) {
    issues.push(error("relation_target_type_mismatch", `Target type ${target.type} does not match ${input.candidate.targetType}.`));
  }
  if (input.candidate.reason !== undefined && input.candidate.reason.trim().length === 0) {
    issues.push(error("relation_reason_required", "A relation reason is required."));
  }

  const existingEdges = input.existingEdges.map(normalizeEdge);
  if (existingEdges.some((edge) => sameEdge(edge, candidate))) {
    issues.push(error("relation_exact_duplicate", "This relation already exists or is already pending review."));
  }

  const reverseEdges = existingEdges.filter((edge) =>
    edge.relation === candidate.relation &&
    edge.sourceFile === candidate.targetFile &&
    edge.targetFile === candidate.sourceFile,
  );
  if (reverseEdges.length > 0) {
    if (SYMMETRIC_RELATIONS.has(candidate.relation)) {
      issues.push(error("relation_reverse_duplicate", "The symmetric relation already exists in the reverse direction."));
    } else if (REVERSE_ALLOWED_WITH_WARNING.has(candidate.relation)) {
      issues.push(warning("relation_reverse_direction_warning", "The reverse directional relation already exists; approve only if both directions are independently justified."));
    } else if (!ACYCLIC_RELATIONS.has(candidate.relation)) {
      issues.push(error("relation_reverse_direction_conflict", "The reverse directional relation conflicts with the proposed relation."));
    }
  }

  if (
    ACYCLIC_RELATIONS.has(candidate.relation) &&
    createsCycle(candidate, existingEdges)
  ) {
    issues.push(error("relation_cycle_detected", `${candidate.relation} relations cannot form a cycle.`));
  }

  if (
    candidate.relation === "supersedes" &&
    existingEdges.some((edge) =>
      edge.relation === "supersedes" &&
      edge.targetFile === candidate.targetFile &&
      edge.sourceFile !== candidate.sourceFile,
    )
  ) {
    issues.push(error("relation_competing_supersedes", "Another active concept already supersedes this target."));
  }

  return {
    accepted: issues.every((issue) => issue.severity !== "error"),
    issues: dedupeIssues(issues),
  };
}

export async function loadOkfRelationPreflightContext(input: {
  excludeCandidateId?: string;
  knowledgeBundleId: string;
  workspaceId: string;
}): Promise<OkfRelationPreflightContext> {
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: input.knowledgeBundleId,
    workspaceId: input.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: input.workspaceId,
  });
  const [snapshot, pendingCandidates] = await Promise.all([
    loadOkfExplorerSnapshot({
      knowledgeBundleId: bundle.id,
      knowledgeRoot,
      workspaceId: input.workspaceId,
    }),
    getPrisma().okfRelationCandidate.findMany({
      orderBy: [{ sourceFile: "asc" }, { targetFile: "asc" }, { relation: "asc" }],
      where: {
        id: input.excludeCandidateId ? { not: input.excludeCandidateId } : undefined,
        knowledgeBundleId: bundle.id,
        status: "pending",
        verificationStatus: "confirmed",
        workspaceId: input.workspaceId,
      },
    }),
  ]);

  return {
    activeFiles: snapshot.files
      .filter((file) => !file.isReserved && file.isParseable)
      .map((file) => ({ filePath: file.filename, type: file.type })),
    allowedRelations: bundle.profile.relations,
    existingEdges: [
      ...snapshot.edges.map((edge) => ({
        relation: edge.relation,
        sourceFile: edge.source,
        targetFile: edge.target,
      })),
      ...pendingCandidates.map((candidate) => ({
        relation: candidate.relation,
        sourceFile: candidate.sourceFile,
        targetFile: candidate.targetFile,
      })),
    ],
  };
}

export function relationPreflightSignal(issue: OkfRelationPreflightIssue) {
  return `preflight_${issue.severity}:${issue.code}`;
}

function createsCycle(candidate: OkfRelationGraphEdge, existingEdges: OkfRelationGraphEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of existingEdges) {
    if (edge.relation !== candidate.relation) continue;
    const targets = adjacency.get(edge.sourceFile) ?? new Set<string>();
    targets.add(edge.targetFile);
    adjacency.set(edge.sourceFile, targets);
  }

  const pending = [candidate.targetFile];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === candidate.sourceFile) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function isSafeBundleMarkdownPath(value: string) {
  if (!value || value.includes("\\") || value.includes("?") || value.includes("#") || path.posix.isAbsolute(value) || !value.endsWith(".md")) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

function normalizeEdge<T extends OkfRelationGraphEdge>(edge: T): T {
  return {
    ...edge,
    relation: edge.relation.trim(),
    sourceFile: edge.sourceFile.trim(),
    targetFile: edge.targetFile.trim(),
  };
}

function sameEdge(left: OkfRelationGraphEdge, right: OkfRelationGraphEdge) {
  return left.relation === right.relation && left.sourceFile === right.sourceFile && left.targetFile === right.targetFile;
}

function error(code: OkfRelationPreflightIssue["code"], message: string): OkfRelationPreflightIssue {
  return { code, message, severity: "error" };
}

function warning(code: OkfRelationPreflightIssue["code"], message: string): OkfRelationPreflightIssue {
  return { code, message, severity: "warning" };
}

function dedupeIssues(issues: OkfRelationPreflightIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
