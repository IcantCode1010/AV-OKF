import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatSidePanelSheet } from "@/components/chat/chat-side-panel-sheet";
import { ChatSidePanelContent } from "@/components/chat/chat-side-panel";
import { ChatThread } from "@/components/chat/chat-thread";
import { Button } from "@/components/ui/button";
import { getChatSessionWithMessages, isChatAvailable } from "@/lib/chat-backend";

export const dynamic = "force-dynamic";

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  if (!isChatAvailable()) {
    notFound();
  }

  const { sessionId } = await params;
  const result = await getChatSessionWithMessages(sessionId);

  if (!result) {
    notFound();
  }

  const { session, messages } = result;
  const latestAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant") ??
    null;

  return (
    <div className="grid h-[calc(100vh-7rem)] min-h-[32rem] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card/30">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link href="/chat">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to conversations</span>
              </Link>
            </Button>
            <h1 className="truncate text-lg font-semibold">{session.title}</h1>
          </div>
          <ChatSidePanelSheet>
            <ChatSidePanelContent
              latestAssistantMessage={latestAssistantMessage}
            />
          </ChatSidePanelSheet>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <ChatThread messages={messages} />
        </div>

        <div className="shrink-0 border-t border-border bg-background/95 p-3">
          <ChatComposer sessionId={session.id} />
        </div>
      </div>

      <aside className="hidden min-h-0 lg:block">
        <div className="h-full overflow-y-auto">
          <ChatSidePanelContent
            latestAssistantMessage={latestAssistantMessage}
          />
        </div>
      </aside>
    </div>
  );
}
