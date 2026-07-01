import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getCurrentWorkspace } from "@/lib/mock-data";

export default function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell user={getCurrentUser()} workspace={getCurrentWorkspace()}>
      {children}
    </AppShell>
  );
}
