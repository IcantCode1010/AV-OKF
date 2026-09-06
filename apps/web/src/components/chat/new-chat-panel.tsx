"use client";

import { useState, useTransition } from "react";
import { BookOpenText, MessageSquareText } from "lucide-react";

import { createAndSendChatMessageAction } from "@/app/(app)/chat/actions";
import { ChatComposer } from "@/components/chat/chat-composer";
import { Badge } from "@/components/ui/badge";

export function NewChatPanel({ activeBundle, allCollections=false }: { allCollections?:boolean; activeBundle: { id: string; name: string } | null }) {
  const [isPending, startTransition] = useTransition();
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  function handleSend(content: string) {
    if (!activeBundle) return;
    setPendingQuestion(content);
    const formData = new FormData();
    formData.set("knowledgeBundleId", activeBundle.id);
    formData.set("content", content);
    startTransition(() => createAndSendChatMessageAction(formData));
  }

  return (
    <div className="flex h-full min-h-[32rem] flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <MessageSquareText className="h-5 w-5" aria-hidden="true" />
        <div><h1 className="text-sm font-semibold">New conversation</h1><p className="text-xs text-muted-foreground">{allCollections?"All accessible collections":activeBundle?.name ?? "No knowledge source selected"}</p></div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
        <div className="w-full max-w-2xl text-center">
          <BookOpenText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-2xl font-semibold">{allCollections?"Ask your knowledge library":"Ask your approved knowledge"}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{allCollections?"Search your full accessible knowledge library. You can narrow the collection scope in the conversation.":"Answers are grounded in the active bundle. You can add other knowledge sources after the conversation starts."}</p>
          {activeBundle ? <Badge className="mt-4" variant="outline">{allCollections?"All accessible collections":activeBundle.name}</Badge> : null}
          {pendingQuestion ? <div className="mt-8 rounded-md border bg-muted/30 p-4 text-left text-sm"><p>{pendingQuestion}</p><p className="mt-2 text-xs text-muted-foreground">Searching selected knowledge...</p></div> : null}
        </div>
      </div>
      <div className="shrink-0 border-t bg-background/95 p-3">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer isPending={isPending || !activeBundle} onSend={handleSend} sessionId="new" />
          {!activeBundle ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Create or select a knowledge bundle to begin.</p> : null}
        </div>
      </div>
    </div>
  );
}
