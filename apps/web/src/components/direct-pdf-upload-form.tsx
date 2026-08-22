"use client";

import { CheckCircle2, FileText, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_DOCUMENTS_PER_UPLOAD_BATCH, MAX_LARGE_PDF_UPLOAD_BYTES } from "@/lib/document-upload-limits";
import type { DocumentUploadSessionDescriptor } from "@/lib/document-upload-types";
import { getPdfUploadSizeError } from "@/lib/pdf-upload-validation";

type BundleOption = { id: string; name: string };
type FileStatus = "cancelled" | "completed" | "failed" | "finalizing" | "preparing" | "selected" | "uploading";
type UploadEntry = {
  error: string | null;
  file: File;
  href: string | null;
  key: string;
  progress: number;
  session: DocumentUploadSessionDescriptor | null;
  status: FileStatus;
  title: string;
};

const UPLOAD_CONCURRENCY = 3;

export function DirectPdfUploadForm({
  bundles,
  selectedBundleId,
}: {
  bundles: BundleOption[];
  selectedBundleId: string;
}) {
  const router = useRouter();
  const xhrRefs = useRef(new Map<string, XMLHttpRequest>());
  const cancelledKeys = useRef(new Set<string>());
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const busy = entries.some((entry) => ["preparing", "uploading", "finalizing"].includes(entry.status));

  function selectFiles(files: FileList | null) {
    setBatchError(null);
    if (!files) return setEntries([]);
    const selected = Array.from(files);
    if (selected.length > MAX_DOCUMENTS_PER_UPLOAD_BATCH) {
      setEntries([]);
      return setBatchError(`Select no more than ${MAX_DOCUMENTS_PER_UPLOAD_BATCH} PDF files per batch.`);
    }
    const next: UploadEntry[] = [];
    for (const [index, file] of selected.entries()) {
      const error = validatePdfFile(file);
      if (error) {
        setEntries([]);
        return setBatchError(`${file.name}: ${error}`);
      }
      next.push({
        error: null,
        file,
        href: null,
        key: `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${index}`,
        progress: 0,
        session: null,
        status: "selected",
        title: file.name.replace(/\.pdf$/i, ""),
      });
    }
    setEntries(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entries.length === 0) return setBatchError("Choose at least one PDF before uploading.");
    setBatchError(null);
    const form = new FormData(event.currentTarget);
    const commonMetadata = {
      description: String(form.get("description") ?? ""),
      owner: String(form.get("owner") ?? ""),
      sourceType: String(form.get("sourceType") ?? "general"),
      tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    updateAll((entry) => entry.status === "selected" ? { ...entry, error: null, status: "preparing" } : entry);

    try {
      const initiated = await postJson<{
        batchId: string;
        sessions: DocumentUploadSessionDescriptor[];
      }>("/api/document-upload-batches", {
        knowledgeBundleId: String(form.get("knowledgeBundleId") ?? ""),
        uploads: entries.map((entry) => ({
          contentType: "application/pdf",
          filename: entry.file.name,
          metadata: { ...commonMetadata, title: entry.title },
          sizeBytes: entry.file.size,
        })),
      });
      if (initiated.sessions.length !== entries.length) throw new Error("upload_batch_session_mismatch");
      const withSessions = entries.map((entry, index) => ({
        ...entry,
        session: initiated.sessions[index]!,
        status: "preparing" as const,
      }));
      setEntries(withSessions);
      const hrefs = await runWithConcurrency(
        withSessions,
        UPLOAD_CONCURRENCY,
        (entry) => uploadEntry(entry.key, entry.file, entry.session!),
      );
      const completed = hrefs.filter((href): href is string => Boolean(href));
      router.refresh();
      if (withSessions.length === 1 && completed[0]) router.push(completed[0]);
    } catch (error) {
      updateAll((entry) => ["preparing", "uploading", "finalizing"].includes(entry.status)
        ? { ...entry, error: formatUploadFailure(error), status: "failed" }
        : entry);
      setBatchError(formatUploadFailure(error));
    }
  }

  async function uploadEntry(
    key: string,
    file: File,
    session: DocumentUploadSessionDescriptor,
  ) {
    if (cancelledKeys.current.has(key)) return null;
    updateEntry(key, { error: null, progress: 0, session, status: "uploading" });
    try {
      await putFileWithProgress(
        session.uploadUrl,
        session.requiredHeaders,
        file,
        (progress) => updateEntry(key, { progress }),
        (xhr) => xhrRefs.current.set(key, xhr),
      );
      if (cancelledKeys.current.has(key)) return null;
      updateEntry(key, { progress: 100, status: "finalizing" });
      const finalized = await postJson<{ href: string }>(
        `/api/document-uploads/${encodeURIComponent(session.sessionId)}/finalize`,
        {},
      );
      updateEntry(key, { error: null, href: finalized.href, status: "completed" });
      return finalized.href;
    } catch (error) {
      if (!cancelledKeys.current.has(key)) {
        updateEntry(key, { error: formatUploadFailure(error), status: "failed" });
      }
      return null;
    } finally {
      xhrRefs.current.delete(key);
    }
  }

  async function cancel(entry: UploadEntry) {
    cancelledKeys.current.add(entry.key);
    xhrRefs.current.get(entry.key)?.abort();
    if (entry.session) {
      await fetch(`/api/document-uploads/${encodeURIComponent(entry.session.sessionId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    updateEntry(entry.key, {
      error: "Upload cancelled. Its temporary object was removed.",
      progress: 0,
      status: "cancelled",
    });
  }

  async function retry(entry: UploadEntry) {
    if (!entry.session) return;
    cancelledKeys.current.delete(entry.key);
    updateEntry(entry.key, { error: null, progress: 0, status: "preparing" });
    try {
      const session = await postJson<DocumentUploadSessionDescriptor>(
        `/api/document-uploads/${encodeURIComponent(entry.session.sessionId)}/retry`,
        {},
      );
      await uploadEntry(entry.key, entry.file, session);
      router.refresh();
    } catch (error) {
      updateEntry(entry.key, { error: formatUploadFailure(error), status: "failed" });
    }
  }

  function updateEntry(key: string, patch: Partial<UploadEntry>) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function updateAll(update: (entry: UploadEntry) => UploadEntry) {
    setEntries((current) => current.map(update));
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="files">PDF files</Label>
          <Input
            accept="application/pdf,.pdf"
            disabled={busy}
            id="files"
            multiple
            onChange={(event) => selectFiles(event.currentTarget.files)}
            type="file"
          />
          <p className="text-xs text-muted-foreground">
            Up to 10 PDFs per batch. Each file uploads directly to secure storage and retains independent progress, retry, and cancellation.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="knowledgeBundleId">Knowledge bundle</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={selectedBundleId}
            disabled={busy}
            id="knowledgeBundleId"
            name="knowledgeBundleId"
            required
          >
            {bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
          </select>
        </div>
        <Field disabled={busy} id="owner" label="Owner" placeholder="Team or department" />
        <Field disabled={busy} id="tags" label="Tags" placeholder="operations, safety, handbook" />
        <div className="space-y-2">
          <Label htmlFor="sourceType">Source type</Label>
          <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" defaultValue="general" disabled={busy} id="sourceType" name="sourceType">
            <option value="general">General</option><option value="aviation">Aviation</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Shared description</Label>
          <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" disabled={busy} id="description" name="description" placeholder="Description applied to this upload batch" />
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="divide-y divide-border border border-border" aria-live="polite">
          {entries.map((entry) => (
            <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)_160px_auto] md:items-center" key={entry.key}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{entry.file.name}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{formatBytes(entry.file.size)}</p>
              </div>
              <Input
                aria-label={`Title for ${entry.file.name}`}
                disabled={entry.status !== "selected"}
                onChange={(event) => updateEntry(entry.key, { title: event.target.value })}
                value={entry.title}
              />
              <UploadProgress entry={entry} />
              <div className="flex justify-end gap-1">
                {entry.href ? <Button asChild size="sm" variant="outline"><Link href={entry.href}>View</Link></Button> : null}
                {(entry.status === "uploading" ||
                  (entry.status === "preparing" && entry.session)) ? (
                  <Button aria-label={`Cancel ${entry.file.name}`} onClick={() => void cancel(entry)} size="icon" title="Cancel upload" type="button" variant="ghost"><X className="size-4" /></Button>
                ) : null}
                {["cancelled", "failed"].includes(entry.status) && entry.session ? (
                  <Button aria-label={`Retry ${entry.file.name}`} onClick={() => void retry(entry)} size="icon" title="Retry upload" type="button" variant="outline"><RotateCcw className="size-4" /></Button>
                ) : null}
              </div>
              {entry.error ? <p className="text-xs text-destructive md:col-span-4" role="alert">{entry.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {batchError ? <p className="text-sm text-destructive" role="alert">{batchError}</p> : null}
      <Button disabled={busy || entries.length === 0 || entries.every((entry) => entry.status !== "selected")} type="submit">
        <Upload className="size-4" /> Upload {entries.length > 1 ? `${entries.length} PDFs` : "PDF"}
      </Button>
    </form>
  );
}

function UploadProgress({ entry }: { entry: UploadEntry }) {
  if (entry.status === "completed") return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300"><CheckCircle2 className="size-4" /> Processing started</span>;
  if (entry.status === "selected") return <span className="text-xs text-muted-foreground">Ready</span>;
  if (entry.status === "cancelled") return <span className="text-xs text-muted-foreground">Cancelled</span>;
  if (entry.status === "failed") return <span className="text-xs text-destructive">Failed</span>;
  const label = entry.status === "preparing" ? "Preparing" : entry.status === "finalizing" ? "Verifying" : `Uploading ${entry.progress}%`;
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />{label}</span>
      <div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${entry.status === "finalizing" ? 100 : Math.max(2, entry.progress)}%` }} /></div>
    </div>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} name={id} {...props} /></div>;
}

async function runWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]!);
    }
  }));
  return results;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "upload_request_failed");
  return payload;
}

function putFileWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (progress: number) => void,
  onCreate: (xhr: XMLHttpRequest) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onCreate(xhr);
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("object_upload_failed"));
    xhr.onerror = () => reject(new Error("object_upload_failed"));
    xhr.onabort = () => reject(new Error("upload_cancelled"));
    xhr.send(file);
  });
}

function validatePdfFile(file: File) {
  if (file.size === 0) return "The file is empty.";
  const sizeError = getPdfUploadSizeError(file.size, MAX_LARGE_PDF_UPLOAD_BYTES);
  if (sizeError) return sizeError;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "Only PDF uploads are supported.";
  return null;
}

function formatUploadFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "upload_failed";
  const messages: Record<string, string> = {
    invalid_pdf_magic_bytes: "The uploaded file is not a valid PDF.",
    invalid_upload_batch_size: "Select between 1 and 10 PDF files.",
    object_upload_failed: "The storage upload failed. Retry this file.",
    only_pdf_uploads_supported: "Only PDF uploads are supported.",
    upload_batch_session_mismatch: "The server did not prepare every selected file. Start the batch again.",
    upload_cancelled: "Upload cancelled.",
    upload_exceeds_250mb_limit: "The PDF exceeds the 250 MB upload limit.",
    upload_session_expired: "The upload session expired. Retry this file.",
  };
  return messages[code] ?? "The upload could not be completed. Try again.";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
