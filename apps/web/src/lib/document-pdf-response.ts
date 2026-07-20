import type { AuthWorkspaceContext } from "./auth-workspace.ts";

type DocumentPdfDependencies = {
  getBytes(documentId: string): Promise<Buffer>;
  getContext(): Promise<AuthWorkspaceContext>;
  getWorkspaceId(documentId: string): Promise<string | undefined>;
};

export async function createDocumentPdfResponse(
  documentId: string,
  dependencies: DocumentPdfDependencies,
): Promise<Response> {
  try {
    const context = await dependencies.getContext();
    const documentWorkspaceId = await dependencies.getWorkspaceId(documentId);

    if (!documentWorkspaceId || documentWorkspaceId !== context.workspaceId) {
      return notFoundResponse();
    }

    const bytes = await dependencies.getBytes(documentId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'inline; filename="document.pdf"',
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "authentication_required") {
      return new Response("Authentication required", { status: 401 });
    }

    if (isMissingDocumentError(error)) {
      return notFoundResponse();
    }

    console.error("document_pdf_stream_failed", { documentId, error });
    return new Response("Document file is temporarily unavailable", {
      status: 503,
    });
  }
}

function isMissingDocumentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["NoSuchKey", "NotFound"].includes(error.name)) return true;
  return [
    "document_not_found",
    "document_has_no_stored_pdf",
    "NoSuchKey",
    "NotFound",
  ].some((value) => error.message.includes(value));
}

function notFoundResponse(): Response {
  return new Response("Document not found", { status: 404 });
}
