"use server";

import { revalidatePath } from "next/cache";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
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

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
