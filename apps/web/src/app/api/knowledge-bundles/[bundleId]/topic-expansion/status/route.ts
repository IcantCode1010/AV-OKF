import { NextResponse } from "next/server";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { listTopicExpansionState } from "@/lib/topic-expansion";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const [{ bundleId }, context] = await Promise.all([params, requireAuthWorkspaceContext()]);
  const state = await listTopicExpansionState({ context, knowledgeBundleId: bundleId });
  return NextResponse.json(state.progressSnapshot, { headers: { "Cache-Control": "private, no-store" } });
}
