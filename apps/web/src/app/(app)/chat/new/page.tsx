import { NewChatPanel } from "@/components/chat/new-chat-panel";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { resolveActiveKnowledgeBundle } from "@/lib/active-knowledge-bundle";
import { isChatAvailable } from "@/lib/chat-backend";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function NewChatPage() {
  if (!isChatAvailable()) return <div className="p-6 text-sm text-muted-foreground">Chat requires the production backend.</div>;
  const context = await requireAuthWorkspaceContext();
  const bundles = await listKnowledgeBundles(context);
  const { activeBundle } = await resolveActiveKnowledgeBundle(context, bundles);
  return <NewChatPanel activeBundle={activeBundle ? { id: activeBundle.id, name: activeBundle.name } : null} />;
}
