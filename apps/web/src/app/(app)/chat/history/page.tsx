import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";

import { ChatSessionList } from "@/components/chat/chat-session-list";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getChatSessions, isChatAvailable } from "@/lib/chat-backend";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function ChatHistoryPage() {
  if (!isChatAvailable()) return <div className="p-6 text-sm text-muted-foreground">Chat requires the production backend.</div>;
  const context = await requireAuthWorkspaceContext();
  const [sessions, bundles] = await Promise.all([getChatSessions(), listKnowledgeBundles(context)]);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
        <div><p className="text-xs font-medium uppercase text-muted-foreground">Workspace</p><h1 className="text-2xl font-semibold">All conversations</h1><p className="mt-1 text-sm text-muted-foreground">Conversations retain the knowledge sources selected for each answer.</p></div>
        <Button asChild disabled={bundles.length === 0}><Link href="/chat/new"><MessageSquarePlus className="h-4 w-4" />New chat</Link></Button>
      </header>
      <ChatSessionList sessions={sessions} />
    </div>
  );
}
