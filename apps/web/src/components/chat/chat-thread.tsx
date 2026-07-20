"use client";

import { useEffect, useRef } from "react";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import type { ChatMessage } from "@/lib/chat-types";
import type { MetadataClarificationSelection } from "@/lib/chat-router";

export type PendingChatMessage = {
  content: string;
  id: string;
  messageCountBefore: number;
};

export function ChatThread({
  isPending,
  messages,
  onSend,
  pendingMessage,
}: {
  isPending: boolean;
  messages: ChatMessage[];
  onSend: (
    content: string,
    selection?: MetadataClarificationSelection[],
  ) => void;
  pendingMessage?: PendingChatMessage | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestMessageId =
    pendingMessage?.id ?? messages[messages.length - 1]?.id;

  // The thread lives inside an overflow-y-auto container that starts at
  // scrollTop 0, hiding the newest message below the fold on load and after
  // each reply. Keep the latest message in view instead.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [latestMessageId]);

  if (messages.length === 0 && !pendingMessage) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Send a message to start this conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-end gap-6 py-4">
      {messages.map((message, index) => (
        <ChatMessageBubble
          canAnswerClarification={
            !isPending && index === messages.length - 1 && message.role === "assistant"
          }
          key={message.id}
          message={message}
          onClarificationSubmit={onSend}
        />
      ))}
      {pendingMessage ? (
        <>
          <div className="max-w-lg self-end rounded-2xl rounded-br-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground opacity-80">
            {pendingMessage.content}
          </div>
          <div
            className="flex max-w-3xl items-center gap-3 self-start rounded-2xl rounded-bl-sm border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
            <span>Searching the knowledge bundle and raw document evidence</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
            </span>
          </div>
        </>
      ) : null}
      <div ref={bottomRef} aria-hidden className="h-px shrink-0" />
    </div>
  );
}
