export const RESEARCH_POLICY_VERSION = "graph-research-v6";
export const EDITORIAL_POLICY_VERSION = "instructor-v2";
export type KnowledgeScope = {
  workspaceId: string;
  userId: string;
  collectionIds: string[];
  documentIds: string[];
  fingerprint: string;
};
export type EvidenceRef = {
  id: string;
  documentId: string;
  documentTitle: string;
  collectionId: string | null;
  page: number;
  quote: string;
  sourceHash: string;
  revision: string;
  applicability: string;
  authority: string;
  trust: "raw-source" | "reviewed" | "legacy";
};
export type ResearchResult = {
  graphConnections?: import("./research-graph-provenance.ts").ResearchGraphConnection[];
  evidence: EvidenceRef[];
  coverage: "retrieved" | "partial";
  gaps: string[];
  toolCalls: number;
  modelSteps: number;
};
export type JobProgress = {
  stage: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  message: string;
  warnings: string[];
  errorCode?: string;
  retryable: boolean;
  checkpoint?: { documentId?: string; page?: number };
};
export const researchLimits = {
  chat: { steps: 12, calls: 24, milliseconds: 90000 },
  authoring: { steps: 24, calls: 80, milliseconds: 600000 },
} as const;
export function knowledgeFeature(
  name: "shared" | "chat" | "authoring" | "export",
) {
  return process.env[`AV_OKF_${name.toUpperCase()}_ENABLED`] === "true";
}
