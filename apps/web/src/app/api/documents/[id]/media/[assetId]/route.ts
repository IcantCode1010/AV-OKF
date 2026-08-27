import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { getObjectStorage } from "@/lib/production-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string; id: string }> },
) {
  const [{ assetId, id }, context] = await Promise.all([
    params,
    requireAuthWorkspaceContext(),
  ]);
  const asset = await getPrisma().documentMediaAsset.findFirst({
    where: { documentId: id, id: assetId, workspaceId: context.workspaceId },
  });
  if (!asset) return Response.json({ error: "media_asset_not_found" }, { status: 404 });
  const bytes = await getObjectStorage().getObject(asset.objectKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="figure-page-${asset.pageNumber}.png"`,
      "Content-Type": asset.mimeType,
    },
  });
}
