"use client";

import type { KeyboardEvent } from "react";
import { useRef } from "react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { sendChatMessageAction } from "@/app/(app)/chat/actions";

const textareaClassName =
  "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function ChatComposer({ sessionId }: { sessionId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={sendChatMessageAction}
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
      <PendingSubmitButton pendingLabel="Sending...">Send</PendingSubmitButton>
    </form>
  );
}
