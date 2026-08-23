import { redirect } from "next/navigation";

export default async function LegacyKnowledgeBundlePage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bundleId }, query] = await Promise.all([params, searchParams]);
  const encoded = encodeURIComponent(bundleId);
  if (query.section === "relations") {
    redirect(`/knowledge/${encoded}/relations`);
  }
  if (query.profileDraft || query.profileActivated || query.deleteError || query.deleted) {
    const params = new URLSearchParams();
    for (const key of ["profileDraft", "profileActivated", "deleteError", "deleted"]) {
      const value = query[key];
      if (typeof value === "string") params.set(key, value);
    }
    redirect(`/knowledge/${encoded}/settings${params.size ? `?${params}` : ""}`);
  }
  if (typeof query.file === "string") {
    redirect(`/knowledge/${encoded}/browse?file=${encodeURIComponent(query.file)}`);
  }
  redirect(`/knowledge/${encoded}/workflow`);
}
