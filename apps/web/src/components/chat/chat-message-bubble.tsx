import { ChatAnswerBody } from "./chat-answer-body";
import { ChatAnswerGraph } from "@/components/chat/chat-answer-graph";
import type { ChatMessage } from "@/lib/chat-types";
import { ChatEvidenceCard } from "@/components/chat/chat-evidence-card";
import { ChatEntityCandidates } from "@/components/chat/chat-entity-candidates";
import { ChatMetadataClarification } from "@/components/chat/chat-metadata-clarification";
import type { MetadataClarificationSelection } from "@/lib/chat-router";

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
      <div className="whitespace-pre-wrap max-w-lg self-end rounded-2xl rounded-br-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
        {message.content}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 w-full max-w-3xl flex-col gap-3 self-start">
      <ChatAnswerBody message={message} />
      {message.trace?.metadataClarification ? (
        <ChatMetadataClarification
          clarification={message.trace.metadataClarification}
          interactive={canAnswerClarification}
          onSubmit={onClarificationSubmit}
        />
      ) : null}
      {message.trace?.responseKind!=="conversation"&&<ChatEvidenceCard message={message} />}
      <ChatAnswerGraph message={message} />
      {message.trace?.entityCandidates?.length ? (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Suggested knowledge topics</summary>
          <ChatEntityCandidates
            candidates={message.trace.entityCandidates}
            messageId={message.id}
            sessionId={message.sessionId}
          />
        </details>
      ) : null}
    </div>
  );
}
