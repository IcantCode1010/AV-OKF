import { DocumentLibrary } from "@/components/document-library";
import { DocumentDeletionPoller } from "@/components/document-deletion-poller";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { MAX_UPLOAD_BYTES, getDocuments } from "@/lib/document-backend";
import { retryPermanentDocumentDeletionAction, uploadDocumentAction } from "./actions";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { listKnowledgeBundles } from "@/lib/knowledge-bundles";
import { getDocumentDeletionStatusSnapshot } from "@/lib/document-deletion";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ deletionJob?: string; uploadError?: string }>;
}) {
  const { deletionJob, uploadError } = await searchParams;
  const context = await requireAuthWorkspaceContext();
  const [documents, bundles, deletionSnapshot] = await Promise.all([
    getDocuments(),
    listKnowledgeBundles(context),
    getDocumentDeletionStatusSnapshot(context),
  ]);
  const deletionJobs = deletionSnapshot.jobs;
  const uploadErrorMessage = formatUploadError(uploadError);
  const selectedDeletion = deletionJobs.find((job) => job.id === deletionJob);

  return (
    <>
      <DocumentDeletionPoller
        active={deletionSnapshot.active}
        fingerprint={deletionSnapshot.fingerprint}
      />
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

      {context.role === "admin" && (deletionJobs.length > 0 || deletionJob) ? (
        <Card className="border-red-400/20">
          <CardHeader>
            <CardTitle>Document deletion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {deletionJob && !selectedDeletion ? (
              <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                Permanent deletion completed. The bundle log contains the removal summary.
              </div>
            ) : null}
            {deletionJobs.map((job) => (
              <div
                className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                key={job.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{job.documentTitle}</p>
                    <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
                      {job.status}
                    </Badge>
                  </div>
                  {job.errorMessage ? (
                    <p className="mt-1 text-xs text-red-200">{job.errorMessage}</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Source and derived products are being removed.
                    </p>
                  )}
                </div>
                {job.status === "failed" ? (
                  <form action={retryPermanentDocumentDeletionAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <PendingSubmitButton pendingLabel="Retrying...">Retry deletion</PendingSubmitButton>
                  </form>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
                  disabled={bundles.length === 0}
                >
                  {bundles.map((bundle) => (
                    <option key={bundle.id} value={bundle.id}>
                      {bundle.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {bundles.length === 0 ? "Create a knowledge bundle before uploading a document." : "Assignment locks when extraction starts. Documents and derived knowledge stay inside this bundle."}
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
              {bundles.length > 0 ? <PendingSubmitButton pendingLabel="Uploading...">Upload PDF</PendingSubmitButton> : <button className="h-9 rounded-md border border-input px-4 text-sm text-muted-foreground" disabled type="button">Create a bundle first</button>}
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
