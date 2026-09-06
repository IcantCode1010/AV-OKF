export function resolveDocumentUploadBundleSelection(
  bundles: Array<{ id: string }>,
  requestedBundleId: string | undefined,
) {
  if (
    requestedBundleId &&
    bundles.some((bundle) => bundle.id === requestedBundleId)
  ) {
    return requestedBundleId;
  }

  return bundles[0]?.id;
}
