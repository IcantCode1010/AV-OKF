import { createHash } from "node:crypto";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { OperationProgressSnapshot } from "./operation-progress.ts";
import { getPrisma } from "./prisma.ts";

export type RelationProgressItem = { automaticApprovalRequested: boolean; id: string; publishedReviewStatus: string | null; status: string; verificationStatus: string; view: "review" | "published" | "processing" | "automatic" | "filtered" | "failed" };
export type RelationProgressData = { items: RelationProgressItem[] };

export async function getRelationProgressSnapshot(input: { bundleId: string; context: AuthWorkspaceContext }): Promise<OperationProgressSnapshot<RelationProgressData>> {
  const rows = await getPrisma().okfRelationCandidate.findMany({ orderBy: { id: "asc" }, select: { automaticApprovalRequested: true, id: true, publishedReviewStatus: true, status: true, updatedAt: true, verificationStatus: true }, where: { knowledgeBundleId: input.bundleId, workspaceId: input.context.workspaceId } });
  const items = rows.map((row) => ({ automaticApprovalRequested: row.automaticApprovalRequested, id: row.id, publishedReviewStatus: row.publishedReviewStatus, status: row.status, verificationStatus: row.verificationStatus, view: relationProgressView(row) }));
  const processing = items.filter((item) => item.view === "processing");
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { active: processing.length > 0, data: { items }, fingerprint, generatedAt: new Date().toISOString(), operations: processing.map((item) => ({ detail: "One relation pair is being checked against exact source evidence.", id: item.id, kind: "relation_verification", label: "Relation verification", stage: item.verificationStatus, status: item.verificationStatus === "queued" ? "queued" : "running", updatedAt: rows.find((row) => row.id === item.id)!.updatedAt.toISOString() })) };
}

function relationProgressView(row: { automaticApprovalRequested: boolean; publishedReviewStatus: string | null; status: string; verificationStatus: string }): RelationProgressItem["view"] {
  if (row.status === "approved" && row.publishedReviewStatus) return "published";
  if (row.automaticApprovalRequested || row.status === "approved") return "automatic";
  if (["queued", "running"].includes(row.verificationStatus) || ["queued", "running"].includes(row.publishedReviewStatus ?? "")) return "processing";
  if (row.verificationStatus === "confirmed") return "review";
  if (row.verificationStatus === "failed") return "failed";
  return "filtered";
}
