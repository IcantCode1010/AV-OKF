import { parseCitationMarkers } from "@/lib/chat-citation-markers";
import type { ChatMessage } from "@/lib/chat-types";
import { ChatEvidenceCard } from "@/components/chat/chat-evidence-card";
import { ChatMetadataClarification } from "@/components/chat/chat-metadata-clarification";
import type { MetadataClarificationSelection } from "@/lib/chat-router";
import { getChatCitationHref } from "@/lib/chat-citation-links";

export function ChatMessageBubble({
  canAnswerClarification = false,
  message,
  onClarificationSubmit,
}: {
  canAnswerClarification?: boolean;
  message: ChatMessage;
  onClarificationSubmit?: (
    content: string,
    selection?: MetadataClarificationSelection[],
  ) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="max-w-lg self-end rounded-2xl rounded-br-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
        {message.content}
      </div>
    );
  }

  const segments = parseCitationMarkers(message.content);

  return (
    <div className="flex max-w-3xl flex-col gap-3 self-start">
      <div className="text-sm leading-relaxed">
        {segments.map((segment, index) => {
          if (segment.type === "text") {
            return <span key={index}>{segment.value}</span>;
          }

          const citation = message.citations.find(
            (candidate) => candidate.index === segment.index,
          );
          const href = citation ? getChatCitationHref(citation) : null;
          const className = "mx-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[0.625rem] font-bold text-accent-foreground align-super focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

          return href ? (
            <a
              className={className}
              href={href}
              key={index}
              rel={citation?.sourceType === "rag" ? "noreferrer" : undefined}
              target={citation?.sourceType === "rag" ? "_blank" : undefined}
              title={`Open ${citation?.documentTitle ?? "source"}`}
            >
              {segment.index}
            </a>
          ) : (
            <span
              key={index}
              title={citation?.documentTitle}
              className={className}
            >
              {segment.index}
            </span>
          );
        })}
      </div>
      {message.trace?.metadataClarification ? (
        <ChatMetadataClarification
          clarification={message.trace.metadataClarification}
          interactive={canAnswerClarification}
          onSubmit={onClarificationSubmit}
        />
      ) : null}
      <ChatEvidenceCard message={message} />
    </div>
  );
}
