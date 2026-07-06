"use client";

import { useEffect, useRef } from "react";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatThread({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestMessageId = messages[messages.length - 1]?.id;

  // The thread lives inside an overflow-y-auto container that starts at
  // scrollTop 0, hiding the newest message below the fold on load and after
  // each reply. Keep the latest message in view instead.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [latestMessageId]);

  if (messages.length === 0) {
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
      {messages.map((message) => (
        <ChatMessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} aria-hidden className="h-px shrink-0" />
    </div>
  );
}
