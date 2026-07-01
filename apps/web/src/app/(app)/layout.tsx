import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getCurrentWorkspace } from "@/lib/mock-data";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (process.env.AV_OKF_BACKEND === "production") {
    const { getProductionShellContext } = await import("@/lib/auth");
    const shell = await getProductionShellContext();

    if (!shell) {
      redirect("/api/auth/signin");
    }

    return (
      <AppShell user={shell.user} workspace={shell.workspace}>
        {children}
      </AppShell>
    );
  }

  return (
    <AppShell user={getCurrentUser()} workspace={getCurrentWorkspace()}>
      {children}
    </AppShell>
  );
}
