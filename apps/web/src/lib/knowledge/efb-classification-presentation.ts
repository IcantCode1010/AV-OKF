export type EfbClassificationPresentation = {
  key: "ready" | "classifying" | "choose_qrh" | "choose_ata" | "fix_evidence" | "fix_applicability" | "registry_changed" | "failed" | "review" | "not_applied";
  label: string;
  actionable: boolean;
};

export function presentEfbClassification(status?: string | null, issues: string[] = []): EfbClassificationPresentation {
  if (!status) return { key: "not_applied", label: "Metadata not applied", actionable: false };
  if (["queued", "running"].includes(status)) return { key: "classifying", label: "Classifying placement", actionable: false };
  if (status === "ready") return { key: "ready", label: "Metadata ready", actionable: false };
  if (["failed", "cancelled"].includes(status)) return { key: "failed", label: "Classification failed", actionable: true };
  if (issues.some((issue) => issue.includes("registry") || issue.includes("inputs_changed"))) return { key: "registry_changed", label: "Registry changed", actionable: true };
  if (issues.some((issue) => issue.includes("document_aircraft") || issue.includes("applicability") || issue.includes("aircraft_evidence"))) return { key: "fix_applicability", label: "Fix document applicability", actionable: true };
  if (issues.some((issue) => issue.includes("pilot_qrh") || issue.includes("qrh_target"))) return { key: "choose_qrh", label: "Choose QRH category", actionable: true };
  if (issues.some((issue) => issue.includes("maintenance_ata") || issue.includes("ata_target"))) return { key: "choose_ata", label: "Choose ATA chapter", actionable: true };
  if (issues.some((issue) => issue.includes("evidence") || issue.includes("quote"))) return { key: "fix_evidence", label: "Fix source evidence", actionable: true };
  return { key: "review", label: "Review metadata", actionable: true };
}
