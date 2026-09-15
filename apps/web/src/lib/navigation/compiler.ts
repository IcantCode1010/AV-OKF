import { classifyNavigationMembership } from "./classify-membership.ts";
import { compileNavigationRelations } from "./compile-relations.ts";
import { generateNavigationHubs } from "./generate-hubs.ts";
import { generateNavigationRoot } from "./generate-root.ts";
import { reportNavigation } from "./report-navigation.ts";
import { NAVIGATION_COMPILER_VERSION, type NavigationArticle } from "./types.ts";
import type { NavigationProfile } from "./profile-schema.ts";

export function compileNavigation(input: { profile: NavigationProfile; articles: NavigationArticle[]; allowedRelations: readonly string[] }) {
  const memberships = classifyNavigationMembership(input.profile, input.articles);
  const compiled = { compilerVersion: NAVIGATION_COMPILER_VERSION as typeof NAVIGATION_COMPILER_VERSION, profile: input.profile, articles: input.articles, memberships, root: generateNavigationRoot(input.profile, memberships, input.articles), hubs: generateNavigationHubs(input.profile, memberships, input.articles), relations: compileNavigationRelations({ articles: input.articles, memberships, allowedRelations: input.allowedRelations }) };
  const report = reportNavigation(compiled);
  if (report.result !== "pass") throw Error(`navigation_graph_invalid:${JSON.stringify(report)}`);
  return { ...compiled, report };
}
