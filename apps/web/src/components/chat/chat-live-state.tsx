"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ChatMessage } from "@/lib/chat-types";
import { ChatSidePanelContent } from "./chat-side-panel";

const ChatLiveContext = createContext<{ messages: ChatMessage[]; setDelivered: Dispatch<SetStateAction<ChatMessage[]>> } | null>(null);

export function ChatLiveProvider({ messages, children }: { messages: ChatMessage[]; children: ReactNode }) {
  const [delivered, setDelivered] = useState<ChatMessage[]>([]);
  const value = useMemo(() => ({
    // Server lifecycle updates remain authoritative for already-known IDs.
    messages: [...messages, ...delivered.filter(message => !messages.some(saved => saved.id === message.id))],
    setDelivered,
  }), [messages, delivered]);
  return <ChatLiveContext.Provider value={value}>{children}</ChatLiveContext.Provider>;
}

export function useChatLiveState() {
  const state = useContext(ChatLiveContext);
  if (!state) throw new Error("chat_live_provider_required");
  return state;
}

export function ChatLiveSidePanel() {
  const { messages } = useChatLiveState();
  return <ChatSidePanelContent latestAssistantMessage={[...messages].reverse().find(message => message.role === "assistant") ?? null} />;
}
