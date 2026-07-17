import { DocumentLibrary } from "@/components/document-library";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { MAX_UPLOAD_BYTES, getDocuments } from "@/lib/document-backend";
import { uploadDocumentAction } from "./actions";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ uploadError?: string }>;
}) {
  const { uploadError } = await searchParams;
  const context = await requireAuthWorkspaceContext();
  const [documents, bundles] = await Promise.all([
    getDocuments(),
    listKnowledgeBundles(context),
  ]);
  const uploadErrorMessage = formatUploadError(uploadError);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Document library</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Documents
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Upload PDFs into the local Stage 1 vault, edit metadata, and keep
            processing status visible before extraction exists.
          </p>
        </div>
        <Badge variant="outline">Max upload 25 MB</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload PDF</CardTitle>
        </CardHeader>
        <CardContent>
          {uploadErrorMessage ? (
            <div className="mb-4 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {uploadErrorMessage}
            </div>
          ) : null}
          <form
            action={uploadDocumentAction}
            className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]"
          >
            <div className="space-y-2">
              <Label htmlFor="file">PDF file</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept="application/pdf,.pdf"
                required
              />
              <p className="text-xs text-muted-foreground">
                Files are stored under opaque keys in the local vault. Limit:{" "}
                {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="knowledgeBundleId">Knowledge bundle</Label>
                <select
                  id="knowledgeBundleId"
                  name="knowledgeBundleId"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  {bundles.map((bundle) => (
                    <option key={bundle.id} value={bundle.id}>
                      {bundle.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Assignment locks when extraction starts. Documents and derived knowledge stay inside this bundle.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" placeholder="Document title" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="owner">Owner</Label>
                <Input
                  id="owner"
                  name="owner"
                  placeholder="Maintenance Control"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <Input id="tags" name="tags" placeholder="737NG, AMM, ATA 24" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sourceType">Source type</Label>
                <select
                  id="sourceType"
                  name="sourceType"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  defaultValue="general"
                >
                  <option value="general">General</option>
                  <option value="aviation">Aviation</option>
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Short description for the document detail page"
                />
              </div>
            </div>

            <div className="flex items-end">
              <PendingSubmitButton pendingLabel="Uploading...">
                Upload PDF
              </PendingSubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <DocumentLibrary documents={documents} />
    </>
  );
}

function formatUploadError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "missing_pdf_file") {
    return "Choose a PDF file before uploading.";
  }

  if (raw === "only_pdf_uploads_supported") {
    return "Only PDF uploads are supported.";
  }

  if (raw === "upload_exceeds_25mb_limit") {
    return "File exceeds the 25 MB upload limit.";
  }

  if (raw === "invalid_pdf_magic_bytes") {
    return "This file isn't a valid PDF. Choose a different file and try again.";
  }

  return "Upload could not be completed.";
}
