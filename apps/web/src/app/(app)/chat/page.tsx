import { ChatSessionList } from "@/components/chat/chat-session-list";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChatSessions, isChatAvailable } from "@/lib/chat-backend";
import { createChatSessionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  if (!isChatAvailable()) {
    return <ChatUnavailableNotice />;
  }

  const sessions = await getChatSessions();

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Chat</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Conversations
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Ask questions across your documents. Each message is routed to
            OKF, RAG, Hybrid, missing-context, or unsupported handling, then
            answered from the retrieved evidence with citations.
          </p>
        </div>
        <form action={createChatSessionAction}>
          <PendingSubmitButton pendingLabel="Starting...">
            New chat
          </PendingSubmitButton>
        </form>
      </div>

      <ChatSessionList sessions={sessions} />
    </>
  );
}

function ChatUnavailableNotice() {
  return (
    <>
      <div>
        <Badge variant="secondary">Chat</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Conversations
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Chat requires the production backend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Chat sessions are stored in Postgres and are not available in local
            JSON-vault dev mode. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              AV_OKF_BACKEND=production
            </code>{" "}
            to enable this page.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
