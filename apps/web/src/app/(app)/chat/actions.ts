"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  createChatSession,
  getChatSessionWorkspaceId,
  sendChatMessage,
} from "@/lib/chat-backend";
import { assertActionDocumentWorkspace } from "@/lib/document-action-guards";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

export async function createChatSessionAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const knowledgeBundleId = getFormString(formData, "knowledgeBundleId");
  const bundle = await getKnowledgeBundle({ bundleId: knowledgeBundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const session = await createChatSession(bundle.id);

  revalidatePath("/chat");
  redirect(`/chat/${session.id}`);
}

export async function sendChatMessageAction(formData: FormData) {
  const sessionId = getFormString(formData, "sessionId");
  const content = getFormString(formData, "content").trim();

  if (!content) {
    throw new Error("chat_message_required");
  }

  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getChatSessionWorkspaceId(sessionId);

  assertActionDocumentWorkspace({
    context,
    document: { workspaceId },
    mismatchError: "chat_session_workspace_mismatch",
  });

  await sendChatMessage(sessionId, content);

  revalidatePath(`/chat/${sessionId}`);
  redirect(`/chat/${sessionId}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
