import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { readOkfBundleEvidenceByPath } from "./okf-bundle-retriever.ts";
import type { OkfGraphTraversalInput } from "./okf-graph-retriever.ts";

export function resolveGraphTarget(sourceFile: string, target: string): string | null {
  const normalized = target.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || !normalized.endsWith(".md")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), normalized));
  return resolved === ".." || resolved.startsWith("../") || resolved.startsWith("/") ? null : resolved;
}

export type IncomingOkfLink = { sourceFile: string; relation: string; targetType?: string };

/** Request-local index: lifecycle changes are observed on every query, with no stale global cache. */
export async function buildIncomingOkfIndex(input: OkfGraphTraversalInput, deadline: number, maxFiles: number) {
  const incoming = new Map<string, IncomingOkfLink[]>();
  const warnings: string[] = [];
  const root = path.resolve(input.knowledgeRoot ?? getDefaultKnowledgeRoot());
  const directories = [""];
  let scanned = 0;
  let entries = 0;
  let indexedEdges = 0;
  const allowed = input.allowedFiles ? new Set(input.allowedFiles) : null;
  const indexFile = async (file: string) => {
    if (Date.now() >= deadline) { warnings.push("graph_index_time_budget_exhausted"); return false; }
    if (scanned >= maxFiles) { warnings.push("graph_index_file_budget_exhausted"); return false; }
    scanned++;
    const evidence = await readOkfBundleEvidenceByPath({ ...input, filePath: file });
    if (!evidence) return true;
    for (const relation of evidence.relations) {
      if (++indexedEdges > 10000) { warnings.push("graph_index_edge_budget_exhausted"); return false; }
      const target = resolveGraphTarget(file, relation.target);
      if (!target || (allowed && !allowed.has(target))) continue;
      const links = incoming.get(target) ?? [];
      links.push({ sourceFile: file, relation: relation.relation, targetType: relation.targetType ?? undefined });
      incoming.set(target, links);
    }
    return true;
  };
  if (allowed) {
    // An explicit scope already supplies the inventory; do not enumerate unrelated directories.
    for (const file of [...allowed].sort()) {
      if (Date.now() >= deadline) { warnings.push("graph_index_time_budget_exhausted"); break; }
      if (++entries > 10000) { warnings.push("graph_index_entry_budget_exhausted"); break; }
      if (!await isRegularScopedFile(root, file)) continue;
      if (!await indexFile(file)) break;
    }
  } else {
    scan: for (let cursor = 0; cursor < directories.length; cursor += 1) {
      if (Date.now() >= deadline) { warnings.push("graph_index_time_budget_exhausted"); break; }
      let directory;
      try { directory = await opendir(path.join(root, directories[cursor])); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for await (const entry of directory) {
        if (Date.now() >= deadline) { warnings.push("graph_index_time_budget_exhausted"); break scan; }
        if (++entries > 10000) { warnings.push("graph_index_entry_budget_exhausted"); break scan; }
        const file = path.posix.join(directories[cursor], entry.name);
        // Dirent checks intentionally exclude symbolic links to other bundles.
        if (entry.isDirectory()) { directories.push(file); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        if (!await indexFile(file)) break scan;
      }
    }
  }
  for (const links of incoming.values()) links.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.relation.localeCompare(b.relation));
  return { incoming, warnings, scanned };
}

async function isRegularScopedFile(root: string, file: string): Promise<boolean> {
  if (!file.endsWith(".md") || file.includes("\\") || path.posix.isAbsolute(file) || file.includes(":")) return false;
  const segments = file.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  let current = root;
  try {
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) return false;
      if (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile()) return false;
    }
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}
