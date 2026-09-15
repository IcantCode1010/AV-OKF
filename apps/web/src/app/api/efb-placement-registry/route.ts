import { NextResponse } from "next/server";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { loadProjectEfbContractRegistry } from "@/lib/project-efb-contract-registry";
import { AVIATION_DOCUMENT_ATA_CHAPTER_IDS } from "@/lib/aviation-document-metadata";

export async function GET() {
  try {
    await requireAuthWorkspaceContext();
    const registry = await loadProjectEfbContractRegistry();
    return NextResponse.json(
      {
        ...registry.placements,
        documentAtaChapterIds: AVIATION_DOCUMENT_ATA_CHAPTER_IDS,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && ["authentication_required", "workspace_access_denied"].includes(error.message)) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "placement_registry_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
