"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { getPdfUploadSizeError } from "@/lib/pdf-upload-validation";

export function PdfUploadInput({ maxBytes }: { maxBytes: number }) {
  const [sizeError, setSizeError] = useState<string | null>(null);

  return (
    <>
      <Input
        id="file"
        name="file"
        type="file"
        accept="application/pdf,.pdf"
        aria-describedby="pdf-upload-help pdf-upload-error"
        aria-invalid={sizeError ? true : undefined}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const error = file ? getPdfUploadSizeError(file.size, maxBytes) : null;
          event.currentTarget.setCustomValidity(error ?? "");
          setSizeError(error);
        }}
        required
      />
      {sizeError ? (
        <p id="pdf-upload-error" className="text-xs text-destructive" role="alert">
          {sizeError} Choose a smaller PDF or split/compress the source before uploading.
        </p>
      ) : null}
    </>
  );
}
