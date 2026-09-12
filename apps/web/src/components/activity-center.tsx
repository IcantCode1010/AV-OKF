"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { ActivitySnapshot, ActivityItem } from "@/lib/activity-types";
const active = (s: string) =>
  ["running", "queued", "pending", "analyzing", "waiting_for_rag", "validating"].includes(s);
const Context = createContext<{
  snapshot: ActivitySnapshot;
  connected: boolean;
  notice: string;
} | null>(null);
export function ActivityProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>({
      items: [],
      generatedAt: "",
    }),
    [connected, setConnected] = useState(true),
    [notice, setNotice] = useState("");
  const prior = useRef<ActivitySnapshot | null>(null);
  const router = useRouter(),
    pathname = usePathname();
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let failures = 0;
    let inFlight=false;
    const poll = async () => {
      if(inFlight||stopped)return;
      inFlight=true;
      let delay = 3000;
      try {
        if (document.hidden) {
          return;
        }
        const response = await fetch("/api/activity", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const next = (await response.json()) as ActivitySnapshot;
        if (!Array.isArray(next.items)) throw Error();
        if (stopped) return;
        setConnected(true);
        failures = 0;
        const changed =
          prior.current &&
          next.items.filter((item) => {
            const old = prior.current!.items.find((i) => i.id === item.id);
            return (
              old &&
              ((active(old.status) && !active(item.status)) ||
                (item.completed !== undefined &&
                  item.completed !== old.completed))
            );
          });
        if (changed?.length) {
          const ended = changed.find((i) => !active(i.status));
          setNotice(
            ended
              ? `${ended.label}: ${ended.failed ? "finished with failures" : "finished"}.`
              : "Enrichment progress updated.",
          );
          router.refresh();
        }
        prior.current = next;
        setSnapshot(next);
        delay = next.items.some((i) => active(i.status)) ? 3000 : 10000;
      } catch {
        if (!stopped) {
          setConnected(false);
          delay = Math.min(30000, 3000 * 2 ** Math.min(++failures, 3));
        }
      } finally {
        inFlight=false;
        if (!stopped) timer = setTimeout(poll, delay);
      }
    };
    void poll();
    const refresh = () => {
      clearTimeout(timer);
      void poll();
    };
    window.addEventListener("activity-started", refresh);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("activity-started", refresh);
    };
  }, [router, pathname]);
  return (
    <Context.Provider value={{ snapshot, connected, notice }}>
      {children}
    </Context.Provider>
  );
}
function duration(seconds: number) {
  return seconds < 60
    ? `${Math.max(0, Math.round(seconds))}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
export function ActivityCard({ item }: { item: ActivityItem }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active(item.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [item.status]);
  return (
    <article className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{item.label}</strong>
        <span>{item.status.replaceAll("_", " ")}</span>
      </div>
      <p>{item.detail}</p>
      {item.total !== undefined && (
        <>
          <p>
            {item.completed ?? 0} of {item.total} finished · {item.failed ?? 0}{" "}
            failed
          </p>
          <progress
            className="h-2 w-full"
            max={item.total || 1}
            value={item.completed ?? 0}
            aria-label={`${item.completed ?? 0} of ${item.total} topics finished`}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {active(item.status)
          ? `Elapsed ${duration((now - Date.parse(item.startedAt)) / 1000)}`
          : item.finishedAt
            ? `Finished ${new Date(item.finishedAt).toLocaleTimeString()}`
            : "Operation no longer running"}
        {active(item.status) &&
          (item.remainingSeconds !== undefined
            ? ` · Roughly ${duration(item.remainingSeconds)} processing remaining; queue time may add more.`
            : " · Estimating time as work completes.")}
      </p>
      <Link className="underline" href={item.href}>
        Open details
      </Link>
    </article>
  );
}
export function ActivityCenter() {
  const state = useContext(Context);
  if (!state) return null;
  const running = state.snapshot.items.filter((i) => active(i.status)).length;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Activity{running ? ` (${running})` : state.notice ? " · updated" : ""}
          {!state.connected ? " · reconnecting" : ""}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto p-5">
        <SheetTitle>Activity</SheetTitle>
        <p className="my-3 text-sm" role="status">
          {!state.connected
            ? "Connection lost. Showing the last known progress; retrying automatically."
            : state.notice ||
              "Live progress and results from the last 24 hours."}
        </p>
        <div className="space-y-3">
          {state.snapshot.items.map((item) => (
            <ActivityCard item={item} key={item.id} />
          ))}
          {!state.snapshot.items.length && <p>No recent tracked operations.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
export function EnrichmentProgress({ documentId }: { documentId?: string }) {
  const state = useContext(Context);
  if (!state) return null;
  const items = state.snapshot.items.filter(
    (i) =>
      i.label.startsWith("Topic enrichment") &&
      (!documentId || i.href.includes(`documentId=${documentId}`)),
  );
  if (!items.length) return null;
  return (
    <section aria-label="Live enrichment progress" className="space-y-3">
      <h2 className="font-semibold">
        Enrichment progress {!state.connected && "— reconnecting"}
      </h2>
      <p role="status" className="text-sm">
        {state.notice ||
          "Updates automatically. You can leave this page and follow work under Activity."}
      </p>
      {items.map((i) => (
        <ActivityCard item={i} key={i.id} />
      ))}
    </section>
  );
}
