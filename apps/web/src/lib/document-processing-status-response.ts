import type { AuthWorkspaceContext } from "./auth-workspace.ts";

type DocumentProcessingStatusDependencies = {
  allowMissingWorkspace?: boolean;
  getContext(): Promise<AuthWorkspaceContext>;
  getSnapshot(
    documentId: string,
    context: AuthWorkspaceContext,
  ): Promise<{ active: boolean; fingerprint: string } | null>;
  getWorkspaceId(documentId: string): Promise<string | undefined>;
};

export async function createDocumentProcessingStatusResponse(
  documentId: string,
  dependencies: DocumentProcessingStatusDependencies,
): Promise<Response> {
  try {
    const context = await dependencies.getContext();
    const documentWorkspaceId = await dependencies.getWorkspaceId(documentId);
    if (
      (!documentWorkspaceId && !dependencies.allowMissingWorkspace) ||
      (documentWorkspaceId && documentWorkspaceId !== context.workspaceId)
    ) {
      return notFoundResponse();
    }

    const snapshot = await dependencies.getSnapshot(documentId, context);
    if (!snapshot) return notFoundResponse();

    return Response.json(
      snapshot,
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "authentication_required") {
      return new Response("Authentication required", { status: 401 });
    }

    console.error("document_processing_status_failed", { documentId, error });
    return new Response("Processing status is temporarily unavailable", {
      status: 503,
    });
  }
}

function notFoundResponse() {
  return new Response("Document not found", { status: 404 });
}
