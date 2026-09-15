"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useRef } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

const textareaClassName =
  "min-h-11 max-h-40 min-w-0 flex-1 resize-y rounded-md bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function ChatComposer({
  isPending,
  onSend,
  sessionId,
}: {
  isPending: boolean;
  onSend: (content: string) => void;
  sessionId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const content = getFormString(formData, "content").trim();

    if (!content || isPending) {
      return;
    }

    form.reset();
    onSend(content);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-lg border border-input bg-card p-2 shadow-sm focus-within:border-ring"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <textarea
        name="content"
        rows={1}
        required
        aria-label="Message"
        placeholder="Ask a question or follow up..."
        className={textareaClassName}
        onKeyDown={handleKeyDown}
      />
      <Button type="submit" size="icon" className="mb-0.5 shrink-0" disabled={isPending} title={isPending ? "Waiting for answer" : "Send message"} aria-label={isPending ? "Waiting for answer" : "Send message"}>
        {isPending ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </Button>
    </form>
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
