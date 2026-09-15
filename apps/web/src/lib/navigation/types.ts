import type { NavigationProfile } from "./profile-schema.ts";

export const NAVIGATION_COMPILER_VERSION = "1.0.0";

export type NavigationArticle = {
  id: string;
  title: string;
  type: string;
  relativePath: string;
  sourceOrder?: number;
  metadata: Record<string, unknown>;
  approvedHubEntryId?: string | null;
  sourceHierarchy?: Record<string, string>;
  standaloneApproved?: boolean;
  technicalRelations?: NavigationRelation[];
};

export type NavigationMembership = {
  articleId: string;
  parentEntryId: string;
  displayOrder: number;
  classificationMethod: "approved-metadata" | "source-hierarchy" | "structured-classification" | "profile-rule" | "manual-standalone";
  confidence: number;
};

export type NavigationRelation = {
  relation: string;
  target: string;
  targetType: string;
  reason: string;
};

export type CompiledNavigationRelation = NavigationRelation & { from: string; structural: boolean };

export type NavigationNode = {
  id: string;
  title: string;
  type: string;
  relativePath: string;
  markdown: string;
  childIds: string[];
};

export type CompiledNavigation = {
  compilerVersion: typeof NAVIGATION_COMPILER_VERSION;
  profile: NavigationProfile;
  root: NavigationNode;
  hubs: NavigationNode[];
  articles: NavigationArticle[];
  memberships: NavigationMembership[];
  relations: CompiledNavigationRelation[];
};
