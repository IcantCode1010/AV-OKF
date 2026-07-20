import type { Stage6aRouterTrace } from "./chat-router.ts";

export type ChatRole = "user" | "assistant";

export type ChatOkfEvidenceMode = "direct" | "graph";

// Persisted, render-facing projection of a RetrievalResult (rag-types.ts):
// text is a short excerpt sized for citation chips and stored trace JSON,
// not the full retrieved chunk (see ChatRetrievalEvidence for that).
export type ChatCitation = {
  // Approved OKF concepts governing this chunk via coverage links; optional
  // because citations persisted before coverage threading lack it. Stage 7
  // validation treats a covering OKF concept as the controlling source.
  coveredByOkfConceptIds?: string[];
  documentId?: string;
  documentTitle: string;
  index: number;
  okfEvidenceMode?: ChatOkfEvidenceMode;
  okfFilePath?: string;
  knowledgeBundleId?: string;
  lifecycleNotice?: string;
  pageEnd: number;
  pageStart: number;
  sourceFile?: string;
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
  trace: Stage6aRouterTrace | null;
};

export type ChatSession = {
  createdAt: string;
  id: string;
  knowledgeBundleId: string;
  title: string;
  updatedAt: string;
  userId: string;
  workspaceId: string;
};
