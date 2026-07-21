import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  getDocumentById,
  getDocumentWorkspaceId,
} from "@/lib/document-backend";
import {
  buildDocumentProcessingFingerprint,
} from "@/lib/document-processing-state";
import { createDocumentProcessingStatusResponse } from "@/lib/document-processing-status-response";
import { isProductionBackend } from "@/lib/production-document-service";
import { getProductionDocumentProcessingFingerprint } from "@/lib/production-document-processing-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return createDocumentProcessingStatusResponse(id, {
    // Legacy JSON-vault documents may predate workspace ownership metadata.
    allowMissingWorkspace: !isProductionBackend(),
    getContext: requireAuthWorkspaceContext,
    getFingerprint: async (documentId, context) => {
      if (isProductionBackend()) {
        return getProductionDocumentProcessingFingerprint({
          context,
          documentId,
        });
      }

      const document = await getDocumentById(documentId);
      if (!document) return null;
      return buildDocumentProcessingFingerprint({ authoringRun: null, document });
    },
    getWorkspaceId: getDocumentWorkspaceId,
  });
}
