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
import type { MetadataClarificationSelection } from "@/lib/chat-router";

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
  const metadataSelection = parseMetadataSelection(
    getFormString(formData, "metadataSelection"),
  );

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

  await sendChatMessage(sessionId, content, metadataSelection);

  revalidatePath(`/chat/${sessionId}`);
  redirect(`/chat/${sessionId}`);
}

function parseMetadataSelection(
  value: string,
): MetadataClarificationSelection[] | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("metadata_clarification_selection_invalid");
  }
  if (!Array.isArray(parsed) || !parsed.every(isMetadataSelection)) {
    throw new Error("metadata_clarification_selection_invalid");
  }
  return parsed;
}

function isMetadataSelection(
  value: unknown,
): value is MetadataClarificationSelection {
  return Boolean(
    value &&
      typeof value === "object" &&
      "field" in value &&
      typeof value.field === "string" &&
      "label" in value &&
      typeof value.label === "string" &&
      "value" in value &&
      typeof value.value === "string",
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
