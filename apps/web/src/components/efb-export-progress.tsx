"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Release = {
  id: string;
  status: string;
  createdAt: string;
  itemCount: number;
  stage?: string;
};

export function EfbExportProgress({ releases, publication = false }: { releases: Release[]; publication?: boolean }) {
  const router = useRouter();
  const active = releases.find((release) =>
    ["queued", "validating", "running"].includes(release.status),
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  if (!active) return null;
  const validating = active.status === "validating";
  const label = publication ? `Push to EFB: ${(active.stage ?? active.status).replaceAll("_", " ")}` : validating
    ? "Validating sources and building the signed OKF package"
    : "Package build queued";

  return (
    <section aria-live="polite" className="space-y-3 rounded border border-sky-500/40 bg-sky-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{publication ? "Pushing to EFB app" : "EFB package progress"}</h2>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <span className="rounded border px-2 py-1 text-xs capitalize">{active.status}</span>
      </div>
      <div aria-label={label} className="h-2 overflow-hidden rounded bg-muted" role="progressbar">
        <div className="h-full w-1/3 animate-pulse bg-sky-500 motion-reduce:animate-none" />
      </div>
      <p className="text-xs text-muted-foreground">
        {active.itemCount} articles · package job {active.id} · started {new Date(active.createdAt).toLocaleString()}
      </p>
    </section>
  );
}
