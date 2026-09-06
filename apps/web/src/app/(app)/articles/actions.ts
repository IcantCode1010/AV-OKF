"use server";
import { revalidatePath } from "next/cache";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { executeEditorialAction } from "@/lib/knowledge/workflow";
export async function knowledgeAction(
  form: FormData,
): Promise<{ error?: string }> {
  try {
    await executeEditorialAction(await requireAuthWorkspaceContext(), form);
    revalidatePath("/articles");
    revalidatePath("/efb-selections");
    revalidatePath("/topic-builder");
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    return {
      error: /^[a-z_]+$/.test(message)
        ? message.replaceAll("_", " ")
        : "Unable to complete this action. Check the inputs and source availability.",
    };
  }
}
