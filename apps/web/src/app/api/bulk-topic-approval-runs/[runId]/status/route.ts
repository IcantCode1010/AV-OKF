import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getBulkTopicApprovalStatusSnapshot } from "@/lib/bulk-topic-approval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = await requireAuthWorkspaceContext();
  const { runId } = await params;
  const snapshot = await getBulkTopicApprovalStatusSnapshot({ context, runId });

  if (!snapshot) {
    return Response.json(
      { error: "bulk_topic_approval_run_not_found" },
      { status: 404 },
    );
  }

  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
