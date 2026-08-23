"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  BookOpen,
  BookOpenCheck,
  Boxes,
  FileCheck2,
  Files,
  GitBranch,
  ListChecks,
  Menu,
  MessageSquare,
  Network,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";

import {
  ActiveBundleSelector,
  type ShellKnowledgeBundle,
} from "@/components/active-bundle-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import type { User, Workspace } from "@/lib/document-vault";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { selectNavigationKnowledgeBundle } from "@/lib/active-bundle-navigation";
import { cn } from "@/lib/utils";

type RecentChat = { id: string; title: string };
type NavigationItem = {
  active: (pathname: string) => boolean;
  href: (bundleId: string) => string;
  icon: typeof MessageSquare;
  label: string;
  requiresBundle?: boolean;
};

const useNavigation: NavigationItem[] = [
  { active: (path) => path.startsWith("/chat"), href: () => "/chat", icon: MessageSquare, label: "Chat" },
  { active: (path) => /^\/knowledge\/[^/]+\/(browse|topic)/.test(path), href: (id) => `/knowledge/${id}/browse`, icon: BookOpen, label: "Browse", requiresBundle: true },
  { active: (path) => /^\/knowledge\/[^/]+\/graph/.test(path), href: (id) => `/knowledge/${id}/graph`, icon: Network, label: "Graph", requiresBundle: true },
];

const manageNavigation: NavigationItem[] = [
  { active: (path) => /^\/knowledge\/[^/]+\/workflow/.test(path), href: (id) => `/knowledge/${id}/workflow`, icon: ListChecks, label: "Workflow", requiresBundle: true },
  { active: (path) => path.startsWith("/documents"), href: (id) => `/documents?scope=bundle&knowledgeBundleId=${id}`, icon: Files, label: "Documents", requiresBundle: true },
  { active: (path) => /^\/knowledge\/[^/]+\/review/.test(path), href: (id) => `/knowledge/${id}/review`, icon: FileCheck2, label: "Review", requiresBundle: true },
  { active: (path) => /^\/knowledge\/[^/]+\/topic-expansion/.test(path), href: (id) => `/knowledge/${id}/topic-expansion`, icon: Sparkles, label: "Topic expansion", requiresBundle: true },
  { active: (path) => /^\/knowledge\/[^/]+\/relations/.test(path), href: (id) => `/knowledge/${id}/relations`, icon: GitBranch, label: "Relations", requiresBundle: true },
  { active: (path) => /^\/knowledge\/[^/]+\/activity/.test(path), href: (id) => `/knowledge/${id}/activity`, icon: Activity, label: "Activity", requiresBundle: true },
];

const workspaceNavigation: NavigationItem[] = [
  { active: (path) => path === "/knowledge", href: () => "/knowledge", icon: Boxes, label: "Knowledge bundles" },
  { active: (path) => path === "/settings", href: () => "/settings", icon: Settings, label: "Settings" },
];

export function AppShell({
  activeBundle,
  bundles,
  children,
  recentChats,
  user,
  workspace,
}: {
  activeBundle: ShellKnowledgeBundle | null;
  bundles: ShellKnowledgeBundle[];
  children: ReactNode;
  recentChats: RecentChat[];
  user: User;
  workspace: Workspace;
}) {
  const pathname = usePathname();
  const navigationBundle = selectNavigationKnowledgeBundle(
    bundles,
    activeBundle,
    pathname,
  );
  const edgeToEdge = pathname.startsWith("/chat/") ||
    /^\/knowledge\/[^/]+\/(browse|graph|activity)/.test(pathname);

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/10 bg-[#17191d] text-zinc-100 lg:block">
        <SidebarContent activeBundle={navigationBundle} bundles={bundles} recentChats={recentChats} workspace={workspace} />
      </aside>
      <div className="min-w-0 lg:pl-64">
        <TopBar activeBundle={navigationBundle} pathname={pathname} user={user} workspace={workspace} bundles={bundles} recentChats={recentChats} />
        <main className={cn("flex min-w-0 w-full max-w-none flex-col", edgeToEdge ? "h-[calc(100dvh-3.25rem)] overflow-hidden" : "gap-6 px-4 py-6 sm:px-6 lg:px-8")}>{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ activeBundle, bundles, recentChats, workspace }: {
  activeBundle: ShellKnowledgeBundle | null;
  bundles: ShellKnowledgeBundle[];
  recentChats: RecentChat[];
  workspace: Workspace;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = activeBundle?.id ?? "";
  const file = searchParams.get("file");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[3.25rem] items-center gap-2 px-4">
        <Link href="/chat" className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-white/5"><BookOpenCheck className="size-4 text-sky-400" /></span>
          <span className="truncate text-sm font-semibold">AV-OKF</span>
        </Link>
      </div>
      <div className="px-3 pb-3"><ActiveBundleSelector activeBundle={activeBundle} bundles={bundles} /></div>
      <Separator className="bg-white/10" />
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <NavigationGroup activeBundleId={activeId} file={file} items={useNavigation} label="Use" pathname={pathname} />
        {activeBundle ? (
          <div className="mb-5 ml-3 border-l border-white/10 pl-3">
            <Link className="flex items-center gap-2 py-1.5 text-xs text-zinc-400 hover:text-white" href="/chat/new"><Plus className="size-3.5" />New chat</Link>
            {recentChats.map((chat) => <Link className="block truncate py-1.5 text-xs text-zinc-500 hover:text-zinc-200" href={`/chat/${chat.id}`} key={chat.id}>{chat.title}</Link>)}
            <Link className="block py-1.5 text-xs text-zinc-400 hover:text-white" href="/chat/history">All conversations</Link>
          </div>
        ) : null}
        <NavigationGroup activeBundleId={activeId} file={file} items={manageNavigation} label="Manage" pathname={pathname} />
        <NavigationGroup activeBundleId={activeId} file={file} items={workspaceNavigation} label="Workspace" pathname={pathname} />
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 px-2"><p className="truncate text-xs font-medium text-zinc-300">{workspace.name}</p><p className="mt-0.5 text-[11px] text-zinc-500">{workspace.memberCount} {workspace.memberCount === 1 ? "member" : "members"}</p></div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function NavigationGroup({ activeBundleId, file, items, label, pathname }: {
  activeBundleId: string;
  file: string | null;
  items: NavigationItem[];
  label: string;
  pathname: string;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-2 text-[10px] font-medium uppercase text-zinc-600">{label}</p>
      <div className="grid gap-0.5">
        {items.map((item) => {
          const disabled = item.requiresBundle && !activeBundleId;
          let href = item.href(activeBundleId);
          if (file && (item.label === "Browse" || item.label === "Graph")) href += `?file=${encodeURIComponent(file)}`;
          const className = cn("flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors", item.active(pathname) ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100", disabled && "pointer-events-none opacity-40");
          return disabled ? <span aria-disabled className={className} key={item.label}><item.icon className="size-4" />{item.label}</span> : <Link className={className} href={href} key={item.label}><item.icon className="size-4" />{item.label}</Link>;
        })}
      </div>
    </div>
  );
}

function TopBar({ activeBundle, bundles, pathname, recentChats, user, workspace }: {
  activeBundle: ShellKnowledgeBundle | null;
  bundles: ShellKnowledgeBundle[];
  pathname: string;
  recentChats: RecentChat[];
  user: User;
  workspace: Workspace;
}) {
  const title = titleForPathname(pathname);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/92 backdrop-blur">
      <div className="flex h-[3.25rem] items-center gap-3 px-4 sm:px-5">
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden"><Menu /><span className="sr-only">Open navigation</span></Button></SheetTrigger>
          <SheetContent side="left" className="w-72 border-white/10 bg-[#17191d] p-0 text-zinc-100"><SheetTitle className="sr-only">Navigation</SheetTitle><SidebarContent activeBundle={activeBundle} bundles={bundles} recentChats={recentChats} workspace={workspace} /></SheetContent>
        </Sheet>
        <div className="min-w-0"><span className="truncate text-sm font-medium">{title}</span>{activeBundle && title !== activeBundle.name ? <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{activeBundle.name}</span> : null}</div>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" className="h-9 gap-2 px-2"><Avatar className="size-7"><AvatarFallback>{user.initials}</AvatarFallback></Avatar><span className="hidden text-sm md:inline">{user.name}</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel><span className="block text-sm">{user.name}</span><span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem asChild><Link href="/settings">Workspace settings</Link></DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function titleForPathname(pathname: string) {
  if (pathname.startsWith("/chat")) return "Chat";
  if (pathname.startsWith("/documents")) return "Documents";
  if (/\/browse/.test(pathname)) return "Browse";
  if (/\/graph/.test(pathname)) return "Graph";
  if (/\/review/.test(pathname)) return "Review";
  if (/\/topic-expansion/.test(pathname)) return "Topic expansion";
  if (/\/relations/.test(pathname)) return "Relations";
  if (/\/activity/.test(pathname)) return "Activity";
  if (/\/workflow/.test(pathname)) return "Workflow";
  if (/\/knowledge\/[^/]+\/topic(?:$|\/|\?)/.test(pathname)) return "Approved concept";
  if (/\/knowledge\/[^/]+\/settings/.test(pathname)) return "Bundle settings";
  if (pathname === "/knowledge") return "Knowledge bundles";
  if (pathname === "/settings") return "Settings";
  return "Workspace";
}
