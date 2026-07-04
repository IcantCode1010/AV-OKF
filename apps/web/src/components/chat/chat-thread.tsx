import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatThread({ messages }: { messages: ChatMessage[] }) {
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
    </div>
  );
}
