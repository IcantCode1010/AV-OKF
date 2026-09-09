import type { CompiledNavigation } from "./types.ts";
import { validateNavigationGraph } from "./validate-graph.ts";

export function reportNavigation(compiled: CompiledNavigation) {
  const validation = validateNavigationGraph(compiled);
  return { profileId: compiled.profile.profile_id, profileVersion: compiled.profile.profile_version, compilerVersion: compiled.compilerVersion, rootCount: 1, hubCount: compiled.hubs.length, technicalArticleCount: compiled.articles.length, navigationEdgeCount: compiled.root.childIds.length + compiled.hubs.reduce((sum, hub) => sum + hub.childIds.length, 0), technicalRelationCount: compiled.relations.filter((relation) => !relation.structural).length, ...validation };
}
