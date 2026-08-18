"use client";

import { Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_LARGE_PDF_UPLOAD_BYTES } from "@/lib/document-upload-limits";
import { getPdfUploadSizeError } from "@/lib/pdf-upload-validation";

type BundleOption = { id: string; name: string };
type UploadState = "idle" | "preparing" | "uploading" | "finalizing";

export function DirectPdfUploadForm({
  bundles,
  selectedBundleId,
}: {
  bundles: BundleOption[];
  selectedBundleId: string;
}) {
  const router = useRouter();
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a PDF file before uploading.");
    const sizeError = getPdfUploadSizeError(file.size, MAX_LARGE_PDF_UPLOAD_BYTES);
    if (sizeError) return setError(sizeError);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return setError("Only PDF uploads are supported.");
    }

    try {
      setState("preparing");
      const initiated = await postJson<{
        requiredHeaders: Record<string, string>;
        sessionId: string;
        uploadUrl: string;
      }>("/api/document-uploads", {
        contentType: "application/pdf",
        filename: file.name,
        knowledgeBundleId: String(form.get("knowledgeBundleId") ?? ""),
        metadata: {
          description: String(form.get("description") ?? ""),
          owner: String(form.get("owner") ?? ""),
          sourceType: String(form.get("sourceType") ?? "general"),
          tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
          title: String(form.get("title") ?? ""),
        },
        sizeBytes: file.size,
      });
      setState("uploading");
      await putFileWithProgress(initiated.uploadUrl, initiated.requiredHeaders, file, (value) => setProgress(value), xhrRef);
      setState("finalizing");
      const finalized = await postJson<{ href: string }>(`/api/document-uploads/${encodeURIComponent(initiated.sessionId)}/finalize`, {});
      router.push(finalized.href);
    } catch (caught) {
      setState("idle");
      setProgress(0);
      setError(formatUploadFailure(caught));
    } finally {
      xhrRef.current = null;
    }
  }

  function cancel() {
    xhrRef.current?.abort();
    setState("idle");
    setProgress(0);
    setError("Upload cancelled. The temporary object will be removed automatically.");
  }

  const busy = state !== "idle";
  return (
    <form className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="file">PDF file</Label>
        <Input id="file" name="file" type="file" accept="application/pdf,.pdf" required disabled={busy} />
        <p className="text-xs text-muted-foreground">Direct upload to secure storage. Limit: 250 MB or 5,000 pages.</p>
        {busy ? (
          <div className="space-y-2" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-sm bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${state === "uploading" ? progress : state === "finalizing" ? 100 : 1}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {state === "preparing" ? "Preparing secure upload..." : state === "uploading" ? `Uploading ${progress}%` : "Verifying PDF and starting processing..."}
            </p>
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="knowledgeBundleId">Knowledge bundle</Label>
          <select id="knowledgeBundleId" name="knowledgeBundleId" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" required disabled={busy} defaultValue={selectedBundleId}>
            {bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
          </select>
        </div>
        <Field id="title" label="Title" placeholder="Document title" disabled={busy} />
        <Field id="owner" label="Owner" placeholder="Team or department" disabled={busy} />
        <Field id="tags" label="Tags" placeholder="operations, safety, handbook" disabled={busy} />
        <div className="space-y-2">
          <Label htmlFor="sourceType">Source type</Label>
          <select id="sourceType" name="sourceType" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" defaultValue="general" disabled={busy}>
            <option value="general">General</option><option value="aviation">Aviation</option>
          </select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description">Description</Label>
          <textarea id="description" name="description" rows={3} disabled={busy} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="Short description for the document detail page" />
        </div>
      </div>

      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}><Upload className="size-4" />{busy ? "Working..." : "Upload PDF"}</Button>
        {state === "uploading" ? <Button type="button" variant="outline" size="icon" onClick={cancel} title="Cancel upload"><X className="size-4" /></Button> : null}
      </div>
    </form>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} name={id} {...props} /></div>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "upload_request_failed");
  return payload;
}

function putFileWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (progress: number) => void, ref: React.MutableRefObject<XMLHttpRequest | null>) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    ref.current = xhr;
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("object_upload_failed"));
    xhr.onerror = () => reject(new Error("object_upload_failed"));
    xhr.onabort = () => reject(new Error("upload_cancelled"));
    xhr.send(file);
  });
}

function formatUploadFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "upload_failed";
  const messages: Record<string, string> = {
    invalid_pdf_magic_bytes: "The uploaded file is not a valid PDF.",
    object_upload_failed: "The storage upload failed. Check the connection and try again.",
    only_pdf_uploads_supported: "Only PDF uploads are supported.",
    upload_cancelled: "Upload cancelled.",
    upload_exceeds_250mb_limit: "The PDF exceeds the 250 MB upload limit.",
    upload_session_expired: "The upload session expired. Start the upload again.",
  };
  return messages[code] ?? "The upload could not be completed. Try again.";
}
