import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { ChatConversationPanel } from "@/components/chat/chat-conversation-panel";
import { ChatSidePanelSheet } from "@/components/chat/chat-side-panel-sheet";
import { ChatLiveProvider, ChatLiveSidePanel } from "@/components/chat/chat-live-state";
import { Button } from "@/components/ui/button";
import { getChatSessionWithMessages, isChatAvailable } from "@/lib/chat-backend";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ChatSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ entityError?: string }>;
}) {
  if (!isChatAvailable()) {
    notFound();
  }

  const { sessionId } = await params;
  const { entityError } = await searchParams;
  const result = await getChatSessionWithMessages(sessionId);

  if (!result) {
    notFound();
  }

  const { session, messages } = result;
  const context = await requireAuthWorkspaceContext();
  const availableBundles = await listKnowledgeBundles(context);
  const primaryBundle =
    session.knowledgeBundles.find(
      (bundle) => bundle.id === session.primaryKnowledgeBundleId,
    ) ?? session.knowledgeBundles[0];

  return (
    <ChatLiveProvider key={session.id} messages={messages}>
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link href="/chat/history">
                <History className="h-4 w-4" />
                <span className="sr-only">All conversations</span>
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{session.title}</h1>
              <Badge className="mt-1" variant="outline">
                {primaryBundle?.name ?? "No knowledge source"}
              </Badge>
            </div>
          </div>
          <ChatSidePanelSheet>
            <ChatLiveSidePanel />
          </ChatSidePanelSheet>
        </div>
        {entityError ? (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {entityPromotionErrorMessage(entityError)}
          </div>
        ) : null}

        <ChatConversationPanel
          availableBundles={availableBundles.map((bundle) => ({
            id: bundle.id,
            name: bundle.name,
          }))}
          selectedBundleIds={session.knowledgeBundles.map((bundle) => bundle.id)}
          sessionId={session.id}
        />
      </div>

    </div>
    </ChatLiveProvider>
  );
}

function entityPromotionErrorMessage(code: string) {
  if (code === "chat_entity_identity_collision") {
    return "This entity conflicts with an existing knowledge record and was not added.";
  }
  if (code === "chat_entity_candidate_source_unavailable") {
    return "The supporting source is no longer available, so this entity cannot be added.";
  }
  return "This entity suggestion is no longer available. Refresh the conversation and try again.";
}
