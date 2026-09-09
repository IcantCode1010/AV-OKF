import type { NavigationProfile } from "./profile-schema.ts";
import type { NavigationArticle, NavigationMembership } from "./types.ts";

export function classifyNavigationMembership(
  profile: NavigationProfile,
  articles: NavigationArticle[],
): NavigationMembership[] {
  const hubIds = new Set(profile.hubs.map((hub) => hub.entry_id));
  const ordered = [...articles].sort(articleComparator(profile));
  return ordered.map((article, index) => {
    if (!profile.applicable_types.includes(article.type))
      throw Error(`navigation_article_type_not_applicable:${article.id}`);
    const match = (values: Record<string, unknown> | undefined, method: NavigationMembership["classificationMethod"]) => profile.hubs.flatMap((hub) => {
      const value = values?.[hub.match.field];
      const candidates = Array.isArray(value) ? value : [value];
      return candidates.some((candidate) => typeof candidate === "string" && hub.match.values.includes(candidate))
        ? [{ id: hub.entry_id, method, confidence: 1 }] : [];
    });
    const levels = [
      article.approvedHubEntryId ? [{ id: article.approvedHubEntryId, method: "approved-metadata" as const, confidence: 1 }] : [],
      match(article.sourceHierarchy, "source-hierarchy"),
      match(article.metadata.navigation as Record<string, unknown> | undefined, "structured-classification"),
      match(article.metadata, "profile-rule"),
      profile.hubs.flatMap((hub) => hub.match.title_keywords.some((keyword) => article.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
        ? [{ id: hub.entry_id, method: "profile-rule" as const, confidence: 0.9 }] : []),
    ];
    const candidates = levels.find((level) => level.length > 0) ?? [];
    const selected = candidates[0];
    if (selected) {
      if (!hubIds.has(selected.id)) throw Error(`navigation_unknown_hub:${article.id}:${selected.id}`);
      const distinct = new Set(candidates.map((candidate) => candidate.id));
      if (distinct.size > 1) throw Error(`navigation_ambiguous_membership:${article.id}`);
      return { articleId: article.id, parentEntryId: selected.id, displayOrder: profile.display_order.start + index * profile.display_order.increment, classificationMethod: selected.method, confidence: selected.confidence };
    }
    if (profile.standalone === "explicit-approved-only" && article.standaloneApproved)
      return { articleId: article.id, parentEntryId: profile.root.entry_id, displayOrder: profile.display_order.start + index * profile.display_order.increment, classificationMethod: "manual-standalone", confidence: 1 };
    throw Error(`navigation_article_unassigned:${article.id}`);
  });
}

function articleComparator(profile: NavigationProfile) {
  return (left: NavigationArticle, right: NavigationArticle) => {
    if (profile.display_order.articles === "source-order") {
      const order = (left.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.sourceOrder ?? Number.MAX_SAFE_INTEGER);
      if (order) return order;
    }
    if (profile.display_order.articles === "title") {
      const order = left.title.localeCompare(right.title);
      if (order) return order;
    }
    return left.id.localeCompare(right.id);
  };
}
