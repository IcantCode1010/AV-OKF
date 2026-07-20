import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  getDocumentPdfBytes,
  getDocumentWorkspaceId,
} from "@/lib/document-backend";
import { createDocumentPdfResponse } from "@/lib/document-pdf-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return createDocumentPdfResponse(id, {
    getBytes: getDocumentPdfBytes,
    getContext: requireAuthWorkspaceContext,
    getWorkspaceId: getDocumentWorkspaceId,
  });
}
