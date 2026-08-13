"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_KNOWLEDGE_BUNDLE_COOKIE } from "@/lib/active-knowledge-bundle";
import { resolveBundleWorkspaceHref, type BundleWorkspaceSection } from "@/lib/active-bundle-navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

const ALLOWED_SECTIONS = new Set<BundleWorkspaceSection>([
  "activity",
  "browse",
  "bundle-settings",
  "chat",
  "documents",
  "graph",
  "knowledge",
  "relations",
  "review",
  "settings",
]);

export async function setActiveKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "bundleId");
  const requestedSection = getString(formData, "section") as BundleWorkspaceSection;
  const section = ALLOWED_SECTIONS.has(requestedSection)
    ? requestedSection
    : "browse";
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_KNOWLEDGE_BUNDLE_COOKIE, bundle.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  redirect(resolveBundleWorkspaceHref(bundle.id, section));
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
