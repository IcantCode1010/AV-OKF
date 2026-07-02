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

export function normalizeAtaMetadata(value: string | null): string | null {
  const normalized = value?.trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (!/^\d{2}(-\d{2}){0,2}$/.test(normalized)) {
    throw new Error("invalid_ata_format");
  }

  return normalized;
}
