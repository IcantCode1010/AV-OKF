import type { ChatMessage, ChatSession } from "./chat-types.ts";
import { isProductionBackend } from "./production-document-service.ts";
import { getProductionChatService } from "./production-chat-service.ts";

// Chat is a brand-new domain with no pre-Postgres legacy data to preserve,
// unlike Documents/Topics. Rather than build a throwaway local JSON-vault
// store for a backend that's intentionally stubbed in this pass, local dev
// (AV_OKF_BACKEND !== "production") simply reports chat as unavailable.
export function isChatAvailable(): boolean {
  return isProductionBackend();
}

function assertChatAvailable(): void {
  if (!isChatAvailable()) {
    throw new Error("chat_requires_production_backend");
  }
}

export async function createChatSession(title?: string): Promise<ChatSession> {
  assertChatAvailable();
  return getProductionChatService().createSession(title);
}

export async function getChatSessions(): Promise<ChatSession[]> {
  assertChatAvailable();
  return getProductionChatService().getSessions();
}

export async function getChatSessionWorkspaceId(
  sessionId: string,
): Promise<string | undefined> {
  assertChatAvailable();
  return getProductionChatService().getSessionWorkspaceId(sessionId);
}

export async function getChatSessionWithMessages(
  sessionId: string,
): Promise<{ messages: ChatMessage[]; session: ChatSession } | undefined> {
  assertChatAvailable();
  return getProductionChatService().getSessionWithMessages(sessionId);
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
): Promise<{ assistantMessage: ChatMessage; userMessage: ChatMessage }> {
  assertChatAvailable();
  return getProductionChatService().sendMessage(sessionId, content);
}
