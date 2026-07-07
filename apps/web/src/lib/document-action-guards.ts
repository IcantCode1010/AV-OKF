import type { AuthWorkspaceContext } from "./auth-workspace.ts";

type WorkspaceDocument = {
  workspaceId?: string | null;
};

export function assertActionDocumentWorkspace(input: {
  allowMissingWorkspace?: boolean;
  context: AuthWorkspaceContext;
  document: WorkspaceDocument;
  mismatchError: string;
}): void {
  if (input.document.workspaceId === input.context.workspaceId) {
    return;
  }

  if (input.document.workspaceId == null && input.allowMissingWorkspace) {
    return;
  }

  if (input.document.workspaceId !== input.context.workspaceId) {
    throw new Error(input.mismatchError);
  }
}

const MAX_CLASSIFICATION_CODE_LENGTH = 64;

export function normalizeClassificationCode(value: string | null): string | null {
  const normalized = value?.trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length > MAX_CLASSIFICATION_CODE_LENGTH) {
    throw new Error("classification_code_too_long");
  }

  return normalized;
}
