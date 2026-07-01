import { DocumentLibrary } from "@/components/document-library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDocuments } from "@/lib/mock-data";

export default function DocumentsPage() {
  const documents = getDocuments();

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Document library</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Documents
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Browse the seeded document vault. Upload, storage, and editable
            metadata arrive in Stage 1.
          </p>
        </div>
        <Button disabled>Upload PDF in Stage 1</Button>
      </div>
      <DocumentLibrary documents={documents} />
    </>
  );
}
