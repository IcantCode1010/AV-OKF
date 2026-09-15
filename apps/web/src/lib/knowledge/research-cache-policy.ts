/** Stale cached evidence triggers fresh research; permission and cancellation failures do not. */
export function shouldRefreshResearchCache(error: unknown): boolean {
  return error instanceof Error && [
    "knowledge_evidence_unavailable",
    "knowledge_sources_changed",
    "knowledge_scope_changed",
    "knowledge_graph_changed",
  ].includes(error.message);
}
