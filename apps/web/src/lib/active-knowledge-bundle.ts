import { cookies } from "next/headers";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  listKnowledgeBundles,
  type KnowledgeBundleRecord,
} from "./knowledge-bundles.ts";
import { selectActiveKnowledgeBundle } from "./active-bundle-navigation.ts";

export const ACTIVE_KNOWLEDGE_BUNDLE_COOKIE = "av_okf_active_bundle";

export async function resolveActiveKnowledgeBundle(
  context: AuthWorkspaceContext,
  bundles?: KnowledgeBundleRecord[],
): Promise<{
  activeBundle: KnowledgeBundleRecord | null;
  bundles: KnowledgeBundleRecord[];
}> {
  const availableBundles = bundles ?? (await listKnowledgeBundles(context));
  const cookieStore = await cookies();
  const activeBundle = selectActiveKnowledgeBundle(
    availableBundles,
    cookieStore.get(ACTIVE_KNOWLEDGE_BUNDLE_COOKIE)?.value,
  );

  return { activeBundle, bundles: availableBundles };
}
