"use client";

import { useEffect, useState } from "react";
import { ChatAnswerBody } from "./chat-answer-body";
import { ChatAnswerGraph } from "@/components/chat/chat-answer-graph";
import type { ChatMessage } from "@/lib/chat-types";
import { ChatEvidenceCard } from "@/components/chat/chat-evidence-card";
import { ChatEntityCandidates } from "@/components/chat/chat-entity-candidates";
import { ChatMetadataClarification } from "@/components/chat/chat-metadata-clarification";
import type { MetadataClarificationSelection } from "@/lib/chat-router";
import { Check, Copy, MessageSquareText } from "lucide-react";
import { ChatAnswerSources } from "./chat-answer-sources";
import { ChatSidePanelSheet } from "./chat-side-panel-sheet";
import { ChatSidePanelContent } from "./chat-side-panel";
import { Button } from "@/components/ui/button";

export function ChatMessageBubble({
  canAnswerClarification = false,
  message,
  onClarificationSubmit,
  animate = false,
}: {
  canAnswerClarification?: boolean;
  message: ChatMessage;
  animate?: boolean;
  onClarificationSubmit?: (
    content: string,
    selection?: MetadataClarificationSelection[],
  ) => void;
}) {
  const [length, setLength] = useState(animate ? 0 : message.content.length);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!animate) return;
    const started = performance.now();
    const duration = Math.min(8000, Math.max(600, message.content.length * 3));
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      const fraction = preference.matches ? 1 : Math.min(1, (performance.now() - started) / duration);
      let end = Math.ceil(message.content.length * fraction);
      if (end < message.content.length) { const space = message.content.indexOf(" ", end); end = space < 0 ? message.content.length : space; }
      setLength((current) => Math.max(current, end));
      if (fraction === 1) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [animate, message.content]);
  const revealing = animate && length < message.content.length;
  if (message.role === "user") {
    return (
      <h2 className="mt-8 w-full whitespace-pre-wrap break-words border-t border-border pt-8 text-xl font-semibold leading-snug sm:text-2xl first:mt-0 first:border-0 first:pt-0">
        {message.content}
      </h2>
    );
  }

  return (
    <article aria-label="Assistant answer" className="flex min-w-0 w-full flex-col gap-5">
      <ChatAnswerSources message={message} />
      <h3 className="flex items-center gap-2 text-sm font-medium"><MessageSquareText className="h-4 w-4 text-muted-foreground" />Answer</h3>
      <div aria-busy={revealing}>
        {revealing && <p className="sr-only">{message.content}</p>}
        <div inert={revealing || undefined} aria-hidden={revealing || undefined}><ChatAnswerBody message={revealing ? { ...message, content: message.content.slice(0, length) } : message} /></div>
        {revealing && <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setLength(message.content.length)}>Show full answer</button>}
      </div>
      {!revealing && <>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" title={copied ? "Copied" : "Copy answer"} aria-label={copied ? "Copied" : "Copy answer"} onClick={async () => {
          try { await navigator.clipboard.writeText(message.content); setCopied(true); setCopyError(false); }
          catch { setCopyError(true); }
        }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
        <ChatSidePanelSheet label="Answer details"><ChatSidePanelContent latestAssistantMessage={message} /></ChatSidePanelSheet>
        <span role="status" className="text-xs text-muted-foreground">{copyError ? "Could not copy. Select the answer text to copy it." : copied ? "Answer copied" : ""}</span>
      </div>
      </>}
    </article>
  );
}
