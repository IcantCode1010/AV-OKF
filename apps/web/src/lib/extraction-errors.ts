import type { ExtractionError } from "./document-vault.ts";

export function normalizeExtractionError(error: unknown): ExtractionError {
  const message = error instanceof Error ? error.message : "Unknown extraction error.";
  const normalized = message.toLowerCase();

  if (normalized.includes("password")) {
    return {
      code: "password_protected_pdf",
      message: "PDF appears to be password-protected and cannot be extracted.",
    };
  }

  if (
    normalized.includes("malformed") ||
    normalized.includes("invalid") ||
    normalized.includes("corrupt") ||
    normalized.includes("xref") ||
    normalized.includes("trailer")
  ) {
    return {
      code: "malformed_pdf",
      message: "PDF appears malformed or corrupt and could not be extracted.",
    };
  }

  if (normalized.includes("document_has_no_stored_pdf")) {
    return {
      code: "missing_stored_pdf",
      message: "Document does not have a stored PDF file to extract.",
    };
  }

  return {
    code: "extraction_failed",
    message,
  };
}
