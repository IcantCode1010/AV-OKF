"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { sendChatMessageAction } from "@/app/(app)/chat/actions";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  ChatThread,
  type PendingChatMessage,
} from "@/components/chat/chat-thread";
import type { ChatMessage } from "@/lib/chat-types";
import type { MetadataClarificationSelection } from "@/lib/chat-router";

// The message and reply are saved server-side, but if the client router ever
// fails to apply the resulting RSC update, a reload re-reads the persisted
// state instead of leaving the user on a permanent pending indicator.
const STUCK_REPLY_RELOAD_MS = 10_000;
const MINIMUM_PENDING_ANIMATION_MS = 900;

export function ChatConversationPanel({
  messages,
  sessionId,
}: {
  messages: ChatMessage[];
  sessionId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingMessage, setPendingMessage] =
    useState<PendingChatMessage | null>(null);
  const visiblePendingMessage =
    pendingMessage && messages.length <= pendingMessage.messageCountBefore
      ? pendingMessage
      : null;

  useEffect(() => {
    if (!isPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.location.reload();
    }, STUCK_REPLY_RELOAD_MS);

    return () => window.clearTimeout(timer);
  }, [isPending]);

  function handleSend(
    content: string,
    metadataSelection?: MetadataClarificationSelection[],
  ) {
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("content", content);
    if (metadataSelection) {
      formData.set("metadataSelection", JSON.stringify(metadataSelection));
    }

    setPendingMessage({
      content,
      id: `pending-${Date.now()}`,
      messageCountBefore: messages.length,
    });

    startTransition(async () => {
      await wait(MINIMUM_PENDING_ANIMATION_MS);
      await sendChatMessageAction(formData);
      router.refresh();
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto min-h-full w-full max-w-5xl">
          <ChatThread
            isPending={isPending}
            messages={messages}
            onSend={handleSend}
            pendingMessage={visiblePendingMessage}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 p-3">
        <div className="mx-auto w-full max-w-5xl">
          <ChatComposer
            isPending={isPending}
            onSend={handleSend}
            sessionId={sessionId}
          />
        </div>
      </div>
    </>
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
