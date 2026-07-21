import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  getDocumentById,
  getDocumentWorkspaceId,
} from "@/lib/document-backend";
import {
  buildDocumentProcessingFingerprint,
  shouldPollDocumentProcessing,
} from "@/lib/document-processing-state";
import { createDocumentProcessingStatusResponse } from "@/lib/document-processing-status-response";
import { isProductionBackend } from "@/lib/production-document-service";
import { getProductionDocumentProcessingStatusSnapshot } from "@/lib/production-document-processing-status";

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
    getSnapshot: async (documentId, context) => {
      if (isProductionBackend()) {
        return getProductionDocumentProcessingStatusSnapshot({
          context,
          documentId,
        });
      }

      const document = await getDocumentById(documentId);
      if (!document) return null;
      return {
        active: shouldPollDocumentProcessing({
          extractionStatus: document.extraction.status,
          topicDiscoveryStatus: document.topicDiscovery?.status,
        }),
        fingerprint: buildDocumentProcessingFingerprint({
          authoringRun: null,
          document,
        }),
      };
    },
    getWorkspaceId: getDocumentWorkspaceId,
  });
}
