import { markdownLink } from "./generate-navigation-links.ts";
import type { NavigationArticle, NavigationMembership, NavigationNode } from "./types.ts";
import type { NavigationProfile } from "./profile-schema.ts";

export function generateNavigationRoot(profile: NavigationProfile, memberships: NavigationMembership[], articles: NavigationArticle[]): NavigationNode {
  const relativePath = `indexes/${profile.root.entry_id}.md`;
  const standalone = memberships.filter((item) => item.parentEntryId === profile.root.entry_id)
    .map((item) => articles.find((article) => article.id === item.articleId)!)
    .sort((a, b) => a.id.localeCompare(b.id));
  const children = [
    ...profile.hubs.map((hub) => ({ id: hub.entry_id, title: hub.title, relativePath: `indexes/${hub.entry_id}.md` })),
    ...standalone,
  ];
  return { id: profile.root.entry_id, title: profile.root.title, type: profile.root.type, relativePath, childIds: children.map((child) => child.id), markdown: `# ${profile.root.title}\n\n${children.map((child) => `- ${markdownLink(relativePath, child.relativePath, child.title)}`).join("\n")}\n` };
}
