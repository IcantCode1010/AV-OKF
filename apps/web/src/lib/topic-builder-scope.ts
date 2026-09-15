export function builderSourcesMatchBundle(
  bundleId: string,
  collectionIds: string[],
  documentIds: string[],
  bundleDocumentIds: string[],
): boolean {
  const allowed = new Set(bundleDocumentIds);
  return (collectionIds.length > 0 || documentIds.length > 0)
    && collectionIds.every(id => id === bundleId)
    && documentIds.every(id => allowed.has(id));
}
