"use client";

import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

import { permanentDeleteDocumentAction } from "@/app/(app)/documents/actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function DocumentDeleteControl({ documentId }: { documentId: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="h-4 w-4" />
          Permanently delete document
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Delete this document and everything derived from it?</SheetTitle>
          <SheetDescription>
            This permanently removes the source PDF, extracted text, topics,
            exported OKF concepts, RAG data, relations, and supported assistant
            answers. This action cannot be undone.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 text-sm text-muted-foreground">
          <p>The document becomes inaccessible as soon as deletion starts.</p>
          <p>Any failed storage cleanup remains retryable from Documents.</p>
        </div>
        <SheetFooter>
          <form action={permanentDeleteDocumentAction}>
            <input type="hidden" name="id" value={documentId} />
            <DeleteSubmitButton />
          </form>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" disabled={pending} type="submit" variant="destructive">
      <Trash2 className="h-4 w-4" />
      {pending ? "Starting deletion..." : "Delete permanently"}
    </Button>
  );
}
