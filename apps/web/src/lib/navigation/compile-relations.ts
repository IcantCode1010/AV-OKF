import type { CompiledNavigationRelation, NavigationArticle, NavigationMembership } from "./types.ts";

export function compileNavigationRelations(input: { articles: NavigationArticle[]; memberships: NavigationMembership[]; allowedRelations: readonly string[] }): CompiledNavigationRelation[] {
  const ids = new Set(input.articles.map((article) => article.id));
  const types = new Map(input.articles.map((article) => [article.id, article.type]));
  const structural = input.memberships.map((membership) => ({ from: membership.articleId, structural: true, relation: "part_of", target: membership.parentEntryId, targetType: "index", reason: `This article is part of ${membership.parentEntryId}.` }));
  const technical = input.articles.flatMap((article) => (article.technicalRelations ?? []).map((relation) => ({ ...relation, from: article.id, structural: false })));
  for (const relation of [...structural, ...technical]) {
    if (!input.allowedRelations.includes(relation.relation)) throw Error(`navigation_relation_not_allowed:${relation.relation}`);
    if (!relation.reason.trim()) throw Error("navigation_relation_reason_required");
    if (!relation.structural && !ids.has(relation.target)) throw Error(`navigation_relation_target_missing:${relation.target}`);
    if (!relation.structural && types.get(relation.target) !== relation.targetType)
      throw Error(`navigation_relation_target_type_mismatch:${relation.target}`);
  }
  return [...structural, ...technical];
}
