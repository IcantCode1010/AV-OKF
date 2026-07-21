export function getPdfUploadSizeError(fileSize: number, maxBytes: number): string | null {
  if (fileSize <= maxBytes) return null;

  return `File is ${formatMegabytes(fileSize)} MB. Maximum upload size is ${formatMegabytes(maxBytes)} MB.`;
}

function formatMegabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
