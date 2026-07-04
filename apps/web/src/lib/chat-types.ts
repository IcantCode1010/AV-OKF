export type ChatRole = "user" | "assistant";

// Provisional, for-display-only shape — not backed by real retrieval yet.
// Loosely mirrors RetrievalResult (rag-types.ts) so a future retrieval pass
// can map onto this cleanly.
export type ChatCitation = {
  documentTitle: string;
  index: number;
  pageEnd: number;
  pageStart: number;
  sourceType: "okf" | "rag";
  text: string;
};

export type ChatMessage = {
  citations: ChatCitation[];
  content: string;
  createdAt: string;
  id: string;
  role: ChatRole;
  sessionId: string;
  trace: unknown | null;
};

export type ChatSession = {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
  userId: string;
  workspaceId: string;
};
