import { DocumentDeleteControl } from "@/components/document-delete-control";

export function DocumentHeaderDeleteRow({
  deleteError,
  documentId,
  isAdmin,
}: {
  deleteError: string | null;
  documentId: string;
  isAdmin: boolean;
}) {
  if (!isAdmin) return null;

  return (
    <div
      className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-end"
      data-document-delete-location="header"
    >
      {deleteError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mr-auto">
          {deleteError}
        </div>
      ) : null}
      <DocumentDeleteControl documentId={documentId} />
    </div>
  );
}
