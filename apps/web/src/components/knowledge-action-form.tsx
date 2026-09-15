"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { knowledgeAction } from "@/app/(app)/articles/actions";
export function KnowledgeActionForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <form
      action={(form) =>
        start(async () => {
          setError("");
          setMessage("");
          const result = await knowledgeAction(form);
          setError(result.error ?? "");
          setMessage(result.message ?? "");
          router.refresh();
        })
      }
      className="space-y-3"
    >
      <fieldset disabled={pending} className="space-y-3">
        {children}
      </fieldset>
      {pending && <p role="status">Working…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
