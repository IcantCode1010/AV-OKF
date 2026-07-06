"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

const textareaClassName =
  "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

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

    if (!content) {
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
      className="flex items-end gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <textarea
        name="content"
        rows={1}
        required
        aria-label="Message"
        placeholder="Ask about a system, checklist, or fault..."
        className={textareaClassName}
        onKeyDown={handleKeyDown}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Sending..." : "Send"}
      </Button>
    </form>
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
