"use client";
import { useState, useTransition, type ReactNode } from "react";
import { knowledgeAction } from "@/app/(app)/articles/actions";
export function KnowledgeActionForm({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <form
      action={(form) =>
        start(async () => {
          setError("");
          const result = await knowledgeAction(form);
          setError(result.error ?? "");
        })
      }
      className="space-y-3"
    >
      <fieldset disabled={pending} className="space-y-3">
        {children}
      </fieldset>
      {pending && <p role="status">Working…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
