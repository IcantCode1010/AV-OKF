import type { OkfBundleEvidence } from "./okf-bundle-retriever.ts";
import type { OkfGraphTraversalResult, OkfRelationPath } from "./okf-graph-retriever.ts";

export const GRAPH_EVIDENCE_LIMIT = 8;

export type GraphEvidenceContext = {
  okfFilePath?: string;
  knowledgeBundleId?: string;
  graphDerived?: boolean;
  graphPaths?: OkfRelationPath[];
  graphConnections?: Array<{ source: string; relation: string; target: string; sourceFile?: string; targetFile?: string }>;
};

const scopedFile = (bundle: string | undefined, file: string) => JSON.stringify([bundle ?? "", file]);

/** Reserve complete paths across ranking/retry boundaries, never joining bundles by filename. */
export function selectGraphEvidencePairs<T extends { evidence: GraphEvidenceContext }>(pairs: T[], limit: number): T[] {
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : GRAPH_EVIDENCE_LIMIT;
  const byFile = new Map<string, T>();
  pairs.forEach((pair) => {
    if (pair.evidence.okfFilePath) byFile.set(scopedFile(pair.evidence.knowledgeBundleId, pair.evidence.okfFilePath), pair);
  });
  const selected = new Set<T>();
  for (const pair of pairs) {
    for (const path of pair.evidence.graphPaths ?? []) {
      if (path.files.length < 2 || path.relationTypes.length !== path.files.length - 1) continue;
      const members = path.files.map((file) => byFile.get(scopedFile(pair.evidence.knowledgeBundleId, file)));
      if (members.some((member) => !member)) continue;
      const additional = [...new Set(members as T[])].filter((member) => !selected.has(member));
      if (selected.size + additional.length > budget) continue;
      additional.forEach((member) => selected.add(member));
    }
  }
  for (const pair of pairs) {
    if (selected.size >= budget) break;
    selected.add(pair);
  }
  // Preserve the caller's relevance order after reserving path members.
  return pairs.filter((pair) => selected.has(pair));
}

/** Remove context for endpoints discarded by a later consumer's evidence cap. */
export function pruneGraphEvidenceContext<T extends GraphEvidenceContext>(evidence: T[]): T[] {
  const available = new Set(evidence.flatMap((item) => item.okfFilePath ? [scopedFile(item.knowledgeBundleId, item.okfFilePath)] : []));
  return evidence.map((item) => {
    if (!item.graphPaths && !item.graphConnections) return item;
    const paths = (item.graphPaths ?? []).filter((path) => path.files.length > 1
      && path.relationTypes.length === path.files.length - 1
      && path.files.every((file) => available.has(scopedFile(item.knowledgeBundleId, file))));
    const links = new Set(paths.flatMap((path) => path.relationTypes.map((relation, index) => JSON.stringify([
      path.files[path.directions?.[index] === "incoming" ? index + 1 : index], relation,
      path.files[path.directions?.[index] === "incoming" ? index : index + 1],
    ]))));
    return { ...item, graphPaths: paths, graphConnections: (item.graphConnections ?? []).filter((link) =>
      links.has(JSON.stringify([link.sourceFile, link.relation, link.targetFile])),
    ) };
  });
}

/** Select complete paths before filling remaining space with direct hits. */
export function selectGraphEvidence(input: {
  direct: OkfBundleEvidence[];
  graph: OkfGraphTraversalResult;
  query: string;
  limit?: number;
}): { concepts: OkfBundleEvidence[]; paths: OkfRelationPath[] } {
  const limit = Math.max(1, Math.min(input.limit ?? GRAPH_EVIDENCE_LIMIT, GRAPH_EVIDENCE_LIMIT));
  const all = new Map([...input.direct, ...input.graph.concepts].map((node) => [node.filePath, node]));
  const terms = [...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  const relevance = (file: string) => {
    const node = all.get(file);
    if (!node) return 0;
    const title = node.title.toLowerCase();
    const text = `${node.description} ${node.excerpt}`.toLowerCase();
    return terms.reduce((score, term) => score + (title.includes(term) ? 3 : text.includes(term) ? 1 : 0), 0);
  };
  const rankedPaths = input.graph.paths.filter((entry) =>
    entry.files.length > 1 && entry.relationTypes.length === entry.files.length - 1 && entry.files.every((file) => all.has(file)),
  ).sort((a, b) => relevance(b.files.at(-1)!) - relevance(a.files.at(-1)!)
    || a.files.length - b.files.length || a.files.join("/").localeCompare(b.files.join("/")));
  const selected = new Map<string, OkfBundleEvidence>();
  if (input.direct[0]) selected.set(input.direct[0].filePath, input.direct[0]);
  for (const entry of rankedPaths) {
    const additional = entry.files.filter((file) => !selected.has(file));
    if (selected.size + additional.length > limit) continue;
    additional.forEach((file) => selected.set(file, all.get(file)!));
  }
  const remaining = [...input.graph.concepts].sort((a, b) => relevance(b.filePath) - relevance(a.filePath) || a.filePath.localeCompare(b.filePath));
  for (const node of [...remaining, ...input.direct]) {
    if (selected.size >= limit) break;
    selected.set(node.filePath, node);
  }
  return {
    concepts: [...selected.values()],
    paths: rankedPaths.filter((entry) => entry.files.every((file) => selected.has(file))),
  };
}
