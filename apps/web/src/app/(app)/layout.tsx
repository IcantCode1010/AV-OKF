import {ActivityProvider} from "@/components/activity-center";
import {knowledgeFeature} from "@/lib/knowledge/contracts";
import { AppShell } from "@/components/app-shell";
import { resolveActiveKnowledgeBundle } from "@/lib/active-knowledge-bundle";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getChatSessions, isChatAvailable } from "@/lib/chat-backend";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";
import { getCurrentUser, getCurrentWorkspace } from "@/lib/mock-data";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await requireAuthWorkspaceContext().catch((error: unknown) => {
    if (error instanceof Error && error.message === "authentication_required") redirect("/api/auth/signin");
    throw error;
  });
  const bundles = await listKnowledgeBundles(context);
  const { activeBundle } = await resolveActiveKnowledgeBundle(context, bundles);
  const sessions = isChatAvailable() ? await getChatSessions() : [];
  const recentChats = activeBundle
    ? sessions
        .filter((session) => session.primaryKnowledgeBundleId === activeBundle.id)
        .slice(0, 4)
        .map((session) => ({ id: session.id, title: session.title }))
    : [];
  const shellBundles = bundles.map((bundle) => ({
    description: bundle.description,
    id: bundle.id,
    name: bundle.name,
  }));
  const shellActiveBundle = activeBundle
    ? { description: activeBundle.description, id: activeBundle.id, name: activeBundle.name }
    : null;

  if (process.env.AV_OKF_BACKEND === "production") {
    const { getProductionShellContext } = await import("@/lib/auth");
    const shell = await getProductionShellContext();

    if (!shell) {
      redirect("/api/auth/signin");
    }

    return (
      <ActivityProvider><AppShell knowledgeFeatures={{shared:knowledgeFeature("shared"),export:knowledgeFeature("export")}} activeBundle={shellActiveBundle} bundles={shellBundles} recentChats={recentChats} user={shell.user} workspace={shell.workspace}>
        {children}
      </AppShell></ActivityProvider>
    );
  }

  return (
    <AppShell knowledgeFeatures={{shared:knowledgeFeature("shared"),export:knowledgeFeature("export")}} activeBundle={shellActiveBundle} bundles={shellBundles} recentChats={recentChats} user={getCurrentUser()} workspace={getCurrentWorkspace()}>
      {children}
    </AppShell>
  );
}
