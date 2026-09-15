import type { CompiledNavigation } from "./types.ts";

export type NavigationValidation = { brokenLinks: string[]; orphans: string[]; duplicates: string[]; cycles: string[]; reachableTechnicalArticleCount: number; result: "pass" | "fail" };

export function validateNavigationGraph(compiled: CompiledNavigation): NavigationValidation {
  const nodes = [compiled.root, ...compiled.hubs];
  const articleIds = new Set(compiled.articles.map((article) => article.id));
  const allIds = [...nodes.map((node) => node.id), ...articleIds];
  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  const known = new Set(allIds);
  const brokenLinks = nodes.flatMap((node) => node.childIds.filter((id) => !known.has(id)).map((id) => `${node.id}:${id}`));
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const cycles: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const walk = (id: string) => {
    if (visiting.has(id)) { cycles.push(id); return; }
    if (reachable.has(id)) return;
    reachable.add(id); visiting.add(id);
    for (const child of byId.get(id)?.childIds ?? []) walk(child);
    visiting.delete(id);
  };
  walk(compiled.root.id);
  const orphans = [...articleIds].filter((id) => !reachable.has(id));
  const result = brokenLinks.length || orphans.length || duplicates.length || cycles.length ? "fail" : "pass";
  return { brokenLinks, orphans, duplicates: [...new Set(duplicates)], cycles: [...new Set(cycles)], reachableTechnicalArticleCount: [...articleIds].filter((id) => reachable.has(id)).length, result };
}
