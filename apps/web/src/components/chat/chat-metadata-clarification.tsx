"use client";

import { useMemo, useState } from "react";
import { ListFilter } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MetadataClarification } from "@/lib/okf-bundle-retriever";
import type { MetadataClarificationSelection } from "@/lib/chat-router";

export function ChatMetadataClarification({
  clarification,
  interactive,
  onSubmit,
}: {
  clarification: MetadataClarification;
  interactive: boolean;
  onSubmit?: (
    content: string,
    selection?: MetadataClarificationSelection[],
  ) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const complete = clarification.fields.every((field) => values[field.field]);
  const selection = useMemo(
    () =>
      clarification.fields.flatMap((field) => {
        const value = values[field.field];
        return value ? [{ field: field.field, label: field.label, value }] : [];
      }),
    [clarification.fields, values],
  );

  if (!interactive) {
    return (
      <div className="border-l-2 border-muted-foreground/40 pl-3 text-xs text-muted-foreground">
        {clarification.fields.map((field) => (
          <div key={field.field}>
            {field.label}: {field.options.join(", ")}
          </div>
        ))}
      </div>
    );
  }

  return (
    <form
      className="grid gap-3 border border-border bg-muted/20 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || !onSubmit) return;
        const content = `${selection
          .map((entry) => `${entry.label}: ${entry.value}`)
          .join("; ")}.`;
        onSubmit(content, selection);
      }}
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListFilter className="size-4" />
        Narrow the approved knowledge search
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {clarification.fields.map((field) => (
          <label className="grid gap-1 text-xs" key={field.field}>
            {field.label}
            <select
              className="h-9 border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.field]: event.target.value,
                }))
              }
              value={values[field.field] ?? ""}
            >
              <option value="">Select {field.label.toLocaleLowerCase()}</option>
              {field.options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button className="justify-self-start" disabled={!complete} size="sm" type="submit">
        Continue
      </Button>
    </form>
  );
}
