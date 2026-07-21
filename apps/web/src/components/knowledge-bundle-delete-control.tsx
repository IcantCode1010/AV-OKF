"use client";

import { Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { deleteKnowledgeBundleAction } from "@/app/(app)/knowledge/actions";
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

export function KnowledgeBundleDeleteControl({
  bundleId,
  bundleName,
  documentCount,
}: {
  bundleId: string;
  bundleName: string;
  documentCount: number;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          aria-label={`Delete ${bundleName}`}
          className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          size="sm"
          variant="outline"
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Delete {bundleName} and all derived knowledge?</SheetTitle>
          <SheetDescription>
            The bundle, topics, OKF files, RAG data, relations, profiles, and chats are permanently removed.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 text-sm text-muted-foreground">
          <p>
            {documentCount} document{documentCount === 1 ? "" : "s"} will become Unassigned.
          </p>
          <p>Uploaded PDFs, document metadata, extracted pages, extraction jobs, and logs are preserved.</p>
          <p>This action cannot be undone.</p>
        </div>
        <SheetFooter>
          <form action={deleteKnowledgeBundleAction}>
            <input name="knowledgeBundleId" type="hidden" value={bundleId} />
            <DeleteSubmitButton />
          </form>
          <SheetClose asChild><Button variant="outline">Cancel</Button></SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" disabled={pending} type="submit" variant="destructive">
      <Trash2 className="size-4" />
      {pending ? "Starting deletion..." : "Delete knowledge bundle"}
    </Button>
  );
}
