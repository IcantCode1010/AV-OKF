"use server";
import { revalidatePath } from "next/cache";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { executeEditorialAction } from "@/lib/knowledge/workflow";
export async function knowledgeAction(
  form: FormData,
): Promise<{ error?: string; message?: string }> {
  try {
    const message = await executeEditorialAction(await requireAuthWorkspaceContext(), form);
    revalidatePath("/articles");
    revalidatePath("/efb-selections");
    revalidatePath("/topic-builder");
    return typeof message === "string" ? { message } : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    return {
      error: formatKnowledgeActionError(message),
    };
  }
}

function formatKnowledgeActionError(message: string): string {
  if (/^(?:article_(?:sources_changed|unavailable)|aviation_[a-z_]+|configure_[a-z_]+|efb_[a-z0-9_:-]+|project_efb_[a-z0-9_:-]+|select_[a-z_]+|selected_[a-z_]+)$/i.test(message)) {
    return message.replaceAll("_", " ").replaceAll(":", " · ");
  }
  return "Unable to complete this action. Check the inputs and source availability.";
}
