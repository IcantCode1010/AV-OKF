import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatSession } from "@/lib/chat-types";

export function ChatSessionList({ sessions }: { sessions: ChatSession[] }) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No conversations yet</CardTitle>
          <CardDescription>Start a new chat to begin.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <Link
          key={session.id}
          href={`/chat/${session.id}`}
          className="rounded-xl border border-border bg-card px-4 py-3 text-sm transition hover:border-ring hover:bg-accent"
        >
          <p className="font-medium">{session.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {session.knowledgeBundles.length > 0
              ? session.knowledgeBundles.map((bundle) => bundle.name).join(", ")
              : "No knowledge source"}{" "}
            | Updated {formatTimestamp(session.updatedAt)}
          </p>
        </Link>
      ))}
    </div>
  );
}

function formatTimestamp(iso: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
