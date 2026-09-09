import { markdownLink } from "./generate-navigation-links.ts";
import type { NavigationArticle, NavigationMembership, NavigationNode } from "./types.ts";
import type { NavigationProfile } from "./profile-schema.ts";

export function generateNavigationHubs(profile: NavigationProfile, memberships: NavigationMembership[], articles: NavigationArticle[]): NavigationNode[] {
  return profile.hubs.map((hub) => {
    const relativePath = `indexes/${hub.entry_id}.md`;
    const children = memberships.filter((item) => item.parentEntryId === hub.entry_id).sort((a, b) => a.displayOrder - b.displayOrder || a.articleId.localeCompare(b.articleId)).map((item) => articles.find((article) => article.id === item.articleId)!);
    return { id: hub.entry_id, title: hub.title, type: hub.type, relativePath, childIds: children.map((child) => child.id), markdown: `# ${hub.title}\n\n${children.map((child) => `- ${markdownLink(relativePath, child.relativePath, child.title)}`).join("\n")}\n` };
  });
}
