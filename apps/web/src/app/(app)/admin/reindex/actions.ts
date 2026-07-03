"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { syncApprovedTopicsToRag } from "@/lib/okf-rag-sync";
import { isProductionBackend } from "@/lib/production-document-service";
import { requestDocumentReindex } from "@/lib/rag-reindex";

export async function requestReindexAction(formData: FormData) {
  if (!isProductionBackend()) {
    throw new Error("reindex_requires_production_backend");
  }

  const context = await requireAuthWorkspaceContext();
  const documentId = getFormString(formData, "documentId");
  const chunkingStrategyId = getFormString(formData, "chunkingStrategyId");

  await requestDocumentReindex({
    chunkingStrategyId,
    context,
    documentId,
  });

  revalidatePath("/admin/reindex");
}

export async function syncApprovedTopicsToRagAction() {
  if (!isProductionBackend()) {
    throw new Error("okf_rag_sync_requires_production_backend");
  }

  const context = await requireAuthWorkspaceContext();
  const result = await syncApprovedTopicsToRag(context.workspaceId);

  revalidatePath("/admin/reindex");
  redirect(
    `/admin/reindex?okfSynced=${result.synced}&okfUnchanged=${result.skippedUnchanged}&okfFailed=${result.failed}`,
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
