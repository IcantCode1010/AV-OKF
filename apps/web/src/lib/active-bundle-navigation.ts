export type BundleWorkspaceSection =
  | "activity"
  | "browse"
  | "bundle-settings"
  | "chat"
  | "documents"
  | "graph"
  | "knowledge"
  | "relations"
  | "review"
  | "settings";

export function selectActiveKnowledgeBundle<T extends { id: string }>(
  bundles: T[],
  requestedBundleId: string | null | undefined,
): T | null {
  return bundles.find((bundle) => bundle.id === requestedBundleId) ?? bundles[0] ?? null;
}

export function selectNavigationKnowledgeBundle<T extends { id: string }>(
  bundles: T[],
  activeBundle: T | null,
  pathname: string,
): T | null {
  const routeBundleId = /^\/knowledge\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  if (!routeBundleId) return activeBundle;
  let decodedBundleId: string;
  try {
    decodedBundleId = decodeURIComponent(routeBundleId);
  } catch {
    return activeBundle;
  }
  return bundles.find((bundle) => bundle.id === decodedBundleId) ?? activeBundle;
}

export function resolveBundleWorkspaceHref(bundleId: string, section: BundleWorkspaceSection): string {
  const encoded = encodeURIComponent(bundleId);
  if (section === "chat") return "/chat";
  if (section === "documents") return `/documents?scope=bundle&knowledgeBundleId=${encoded}`;
  if (section === "knowledge") return "/knowledge";
  if (section === "settings") return "/settings";
  if (section === "bundle-settings") return `/knowledge/${encoded}/settings`;
  return `/knowledge/${encoded}/${section}`;
}

export function sectionForPathname(pathname: string): BundleWorkspaceSection {
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/documents")) return "documents";
  if (pathname === "/knowledge") return "knowledge";
  if (pathname === "/settings") return "settings";
  if (/\/knowledge\/[^/]+\/graph(?:\/|$)/.test(pathname)) return "graph";
  if (/\/knowledge\/[^/]+\/review(?:\/|$)/.test(pathname)) return "review";
  if (/\/knowledge\/[^/]+\/relations(?:\/|$)/.test(pathname)) return "relations";
  if (/\/knowledge\/[^/]+\/activity(?:\/|$)/.test(pathname)) return "activity";
  if (/\/knowledge\/[^/]+\/settings(?:\/|$)/.test(pathname)) return "bundle-settings";
  return "browse";
}
