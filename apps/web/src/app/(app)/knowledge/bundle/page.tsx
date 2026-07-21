import { redirect } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getDefaultKnowledgeBundle } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function LegacyKnowledgeBundlePage() {
  const context = await requireAuthWorkspaceContext();
  const bundle = await getDefaultKnowledgeBundle(context);
  if (!bundle) redirect("/knowledge");
  redirect(`/knowledge/${bundle.id}`);
}
