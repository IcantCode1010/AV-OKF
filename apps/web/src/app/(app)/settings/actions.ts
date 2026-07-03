import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  assertLlmSettingsWorkspace,
  clearWorkspaceLlmApiKey,
  saveWorkspaceLlmApiKey,
} from "@/lib/llm-provider-settings";

export async function saveLlmSettingsAction(formData: FormData) {
  "use server";

  const context = await requireAuthWorkspaceContext();
  const workspaceId = getFormString(formData, "workspaceId");
  assertLlmSettingsWorkspace({ context, targetWorkspaceId: workspaceId });

  await saveWorkspaceLlmApiKey(
    workspaceId,
    "anthropic",
    getFormString(formData, "apiKey"),
    {
      updatedBy: context.userId,
    },
  );

  revalidatePath("/settings");
  redirect("/settings");
}

export async function clearLlmSettingsAction(formData: FormData) {
  "use server";

  const context = await requireAuthWorkspaceContext();
  const workspaceId = getFormString(formData, "workspaceId");
  assertLlmSettingsWorkspace({ context, targetWorkspaceId: workspaceId });

  await clearWorkspaceLlmApiKey(workspaceId);

  revalidatePath("/settings");
  redirect("/settings");
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}
