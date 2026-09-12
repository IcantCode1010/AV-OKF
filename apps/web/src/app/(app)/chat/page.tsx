import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { resolveActiveKnowledgeBundle } from "@/lib/active-knowledge-bundle";
import { getChatSessions, isChatAvailable } from "@/lib/chat-backend";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  if (!isChatAvailable()) redirect("/chat/history");
  const context = await requireAuthWorkspaceContext();
  const bundles = await listKnowledgeBundles(context);
  const { activeBundle } = await resolveActiveKnowledgeBundle(context, bundles);
  if (!activeBundle) redirect("/chat/new");
  const sessions = await getChatSessions();
  const recent = sessions.find((session) => session.primaryKnowledgeBundleId === activeBundle.id);
  redirect(recent ? `/chat/${encodeURIComponent(recent.id)}` : "/chat/new");
}
