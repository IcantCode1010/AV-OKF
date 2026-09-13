"use client";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import type { ChatMessage } from "@/lib/chat-types";
import type { MetadataClarificationSelection } from "@/lib/chat-router";
import { LoaderCircle } from "lucide-react";
import { CHAT_STAGE_LABELS } from "@/lib/chat-delivery";

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
  pendingLabel = "Searching selected knowledge and source evidence",
  revealMessageId,
}: {
  isPending: boolean;
  messages: ChatMessage[];
  onSend: (
    content: string,
    selection?: MetadataClarificationSelection[],
  ) => void;
  pendingMessage?: PendingChatMessage | null;
  pendingLabel?: string;
  revealMessageId?: string | null;
}) {
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
    <div className="flex min-h-full flex-col gap-5 py-8 sm:py-10">
      {messages.map((message, index) => (
        <ChatMessageBubble
          canAnswerClarification={
            !isPending && index === messages.length - 1 && message.role === "assistant"
          }
          key={message.id}
          message={message}
          animate={message.id === revealMessageId}
          onClarificationSubmit={onSend}
        />
      ))}
      {pendingMessage ? (
        <>
          <h2 className="mt-8 w-full whitespace-pre-wrap break-words border-t border-border pt-8 text-xl font-semibold leading-snug sm:text-2xl first:mt-0 first:border-0 first:pt-0">
            {pendingMessage.content}
          </h2>
          <details className="border-y border-border py-3">
            <summary className="cursor-pointer text-sm"><span className="ml-1 inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin text-muted-foreground" />Answer progress</span></summary>
            <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
              {Object.entries(CHAT_STAGE_LABELS).map(([key, label]) => <li key={key} aria-current={pendingLabel === label ? "step" : undefined} className={pendingLabel === label ? "font-medium text-foreground" : ""}>{label}{pendingLabel === label ? " (in progress)" : ""}</li>)}
            </ol>
          </details>
          <p role="status" className="text-sm text-muted-foreground">{pendingLabel}</p>
        </>
      ) : null}
      <div aria-hidden className="h-px shrink-0" />
    </div>
  );
}
