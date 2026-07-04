import { parseCitationMarkers } from "@/lib/chat-citation-markers";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="max-w-lg self-end rounded-2xl rounded-br-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
        {message.content}
      </div>
    );
  }

  const segments = parseCitationMarkers(message.content);

  return (
    <div className="max-w-2xl self-start text-sm leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.value}</span>;
        }

        const citation = message.citations.find(
          (candidate) => candidate.index === segment.index,
        );

        return (
          <span
            key={index}
            title={citation?.documentTitle}
            className="mx-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[0.625rem] font-bold text-accent-foreground align-super"
          >
            {segment.index}
          </span>
        );
      })}
    </div>
  );
}
