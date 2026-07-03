const MISSING_METADATA_PREFIX = "okf_export_missing_document_metadata:";

const FIELD_LABELS: Record<string, string> = {
  aircraftFamily: "aircraft family",
  ata: "ATA",
  effectivity: "effectivity",
  manualType: "manual type",
  revision: "revision",
  sourceAuthority: "source authority",
};

export function isRecoverableOkfExportError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.startsWith(MISSING_METADATA_PREFIX) ||
    error.message === "okf_export_requires_approved_topic"
  );
}

export function formatOkfExportError(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  if (raw.startsWith(MISSING_METADATA_PREFIX)) {
    const fields = raw
      .slice(MISSING_METADATA_PREFIX.length)
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)
      .map((field) => FIELD_LABELS[field] ?? field);

    if (fields.length > 0) {
      return `Add missing OKF metadata before export: ${fields.join(", ")}.`;
    }
  }

  if (raw === "okf_export_requires_approved_topic") {
    return "Approve the topic before exporting OKF.";
  }

  return "OKF export could not start.";
}
