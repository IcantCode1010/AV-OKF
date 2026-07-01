import type { DocumentStatus } from "@/lib/document-vault";
import { Badge } from "@/components/ui/badge";

const statusLabels: Record<DocumentStatus, string> = {
  ready: "Ready",
  processing: "Processing",
  needs_review: "Needs review",
  indexed: "Indexed",
  blocked: "Blocked",
};

const statusClasses: Record<DocumentStatus, string> = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  processing: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  needs_review: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  indexed: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  blocked: "border-red-400/30 bg-red-400/10 text-red-300",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge variant="outline" className={statusClasses[status]}>
      {statusLabels[status]}
    </Badge>
  );
}

export { statusLabels };
