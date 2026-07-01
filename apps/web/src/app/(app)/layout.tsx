import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getCurrentWorkspace } from "@/lib/document-vault";
import type { ReactNode } from "react";

export default function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AppShell user={getCurrentUser()} workspace={getCurrentWorkspace()}>
      {children}
    </AppShell>
  );
}
