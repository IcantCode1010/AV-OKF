import { redirect } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { resolveActiveKnowledgeBundle } from "@/lib/active-knowledge-bundle";

export const dynamic = "force-dynamic";

export default async function LegacyKnowledgeBundlePage({ searchParams }: { searchParams: Promise<{ file?: string }> }) {
  const context = await requireAuthWorkspaceContext();
  const [{ activeBundle }, query] = await Promise.all([resolveActiveKnowledgeBundle(context), searchParams]);
  if (!activeBundle) redirect("/knowledge");
  const file = query.file ? `?file=${encodeURIComponent(query.file)}` : "";
  redirect(`/knowledge/${activeBundle.id}/browse${file}`);
}
