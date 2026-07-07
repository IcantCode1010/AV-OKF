"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { markOkfConceptLifecycle } from "@/lib/okf-lifecycle";
import { isProductionBackend } from "@/lib/production-document-service";

export async function deleteOkfBundleFilesAction(formData: FormData) {
  const filenames = formData
    .getAll("filenames")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const reason = getFormString(formData, "reason");
  const context = await requireAuthWorkspaceContext();

  if (!isProductionBackend()) {
    redirect(
      `/knowledge/bundle?deleteError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  if (filenames.length === 0) {
    redirect(
      `/knowledge/bundle?deleteError=${encodeURIComponent(
        "okf_bundle_delete_requires_selection",
      )}`,
    );
  }

  try {
    for (const filePath of filenames) {
      await markOkfConceptLifecycle({
        actorId: context.userId,
        filePath,
        reason,
        status: "deleted",
        workspaceId: context.workspaceId,
      });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "okf_lifecycle_reason_required"
    ) {
      redirect(
        `/knowledge/bundle?deleteError=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  redirect(`/knowledge/bundle?deleted=${filenames.length}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
