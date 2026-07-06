"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { sendChatMessageAction } from "@/app/(app)/chat/actions";

const textareaClassName =
  "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

// The message and reply are always saved server-side within ~1-2s (verified
// directly against the DB), but Next's client router can occasionally fail
// to apply the resulting RSC update to this page, leaving isPending stuck
// true forever with no user-visible error. A full reload is the reliable
// recovery since it re-reads the already-correct server state.
const STUCK_REPLY_RELOAD_MS = 10_000;

export function ChatComposer({ sessionId }: { sessionId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.location.reload();
    }, STUCK_REPLY_RELOAD_MS);

    return () => window.clearTimeout(timer);
  }, [isPending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    form.reset();

    startTransition(async () => {
      await sendChatMessageAction(formData);
      router.refresh();
    });
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
