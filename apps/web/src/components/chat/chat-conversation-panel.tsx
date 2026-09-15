"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatKnowledgeSourceSelector } from "@/components/chat/chat-knowledge-source-selector";
import { ChatThread, type PendingChatMessage } from "@/components/chat/chat-thread";
import type { ChatMessage } from "@/lib/chat-types";
import type { MetadataClarificationSelection } from "@/lib/chat-router";
import { CHAT_STAGE_LABELS, ChatDeliveryFailure, chatHistorySchema, findRecoveredChatReply, readChatDelivery } from "@/lib/chat-delivery";
import { Button } from "@/components/ui/button";
import { useChatLiveState } from "./chat-live-state";

export function ChatConversationPanel({ availableBundles, selectedBundleIds, sessionId }: {
  availableBundles: Array<{ id: string; name: string }>;
  selectedBundleIds: string[]; sessionId: string;
}) {
  const { messages: visibleMessages, setDelivered } = useChatLiveState();
  const [feedback, setFeedback] = useState("");
  const [isPending, setPending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<PendingChatMessage | null>(null);
  const [stage, setStage] = useState(CHAT_STAGE_LABELS.searching);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ afterId: string | null; question: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const viewport = scroll.current, content = contentRef.current;
    if (!viewport || !content) return;
    viewport.scrollTop = viewport.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (follow.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  async function checkSavedAnswer() {
    if (!recovery || checking) return;
    setChecking(true);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/messages`, { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const data = chatHistorySchema.parse(await response.json()) as { messages: ChatMessage[] };
      if (data.messages.some((message) => message.sessionId !== sessionId)) throw new Error("chat_session_mismatch");
      const reply = findRecoveredChatReply(data.messages, recovery.afterId, recovery.question);
      if (!reply) { setFeedback("No saved answer yet. The request may still be running; check again before resending."); return; }
      setDelivered(data.messages); setRevealId(reply.id); setRecovery(null); setFeedback("");
    } catch { setFeedback("Unable to check the conversation. Reconnect and check again before resending."); }
    finally { setChecking(false); }
  }

  async function handleSend(content: string, metadataSelection?: MetadataClarificationSelection[]) {
    if (busy.current || recovery || selectedBundleIds.length === 0) return;
    busy.current = true; setPending(true); setFeedback(""); follow.current = true;
    const afterId = visibleMessages.at(-1)?.id ?? null;
    setPendingMessage({ content, id: `pending-${Date.now()}`, messageCountBefore: visibleMessages.length });
    setStage(CHAT_STAGE_LABELS.searching);
    const controller = new AbortController(); request.current = controller;
    let completed = false;
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, metadataSelection }), signal: controller.signal,
      });
      await readChatDelivery(response, (event) => {
        if (event.type === "progress") setStage(CHAT_STAGE_LABELS[event.stage]);
        if (event.type === "complete") {
          if (event.userMessage.sessionId !== sessionId || event.assistantMessage.sessionId !== sessionId) throw new Error("chat_session_mismatch");
          completed = true;
          setDelivered((current) => [...current, event.userMessage, event.assistantMessage]);
          setRevealId(event.assistantMessage.id); setPendingMessage(null);
        }
      });
    } catch (error) {
      if (!controller.signal.aborted && !completed) {
        if (error instanceof ChatDeliveryFailure) setFeedback(error.message);
        else {
          setRecovery({ afterId, question: content });
          setFeedback("The connection was interrupted. Your answer may still be saving. Check for the saved answer; the question has not been sent again.");
        }
      }
    } finally {
      if (!controller.signal.aborted) { setPending(false); setPendingMessage(null); }
      busy.current = false;
    }
  }

  return <>
    {feedback && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm"><p role="status">{feedback}</p>{recovery && <Button variant="outline" size="sm" disabled={checking} onClick={checkSavedAnswer}>{checking ? "Checking..." : "Check for saved answer"}</Button>}</div>}
    <ChatKnowledgeSourceSelector availableBundles={availableBundles} disabled={isPending || Boolean(recovery)} selectedBundleIds={selectedBundleIds} sessionId={sessionId} />
    <div ref={scroll} onScroll={() => { const element = scroll.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96; }} className="min-h-0 flex-1 overflow-y-auto px-4">
      <div ref={contentRef} className="mx-auto min-h-full w-full max-w-3xl">
        <ChatThread isPending={isPending} messages={visibleMessages} onSend={handleSend} pendingMessage={pendingMessage} pendingLabel={stage} revealMessageId={revealId} />
      </div>
    </div>
    <div className="shrink-0 bg-background p-3 pb-4 sm:px-6"><div className="mx-auto w-full max-w-3xl">
      <ChatComposer isPending={isPending || Boolean(recovery) || selectedBundleIds.length === 0} onSend={handleSend} sessionId={sessionId} />
      {selectedBundleIds.length === 0 && <p className="mt-2 text-xs text-amber-300">Select a knowledge source to continue.</p>}
    </div></div>
  </>;
}
