"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Database,
  FileSearch,
  Files,
  MessageSquare,
  Menu,
  Search,
  Settings,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/documents", label: "Documents", icon: Files },
  { href: "/search", label: "Search", icon: Search },
  { href: "/knowledge", label: "Knowledge", icon: BookOpenCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

const futureNavigation = [
  { label: "Extraction", icon: FileSearch },
  { label: "Retrieval", icon: Database },
];

export function AppShell({
  children,
  user,
  workspace,
}: {
  children: ReactNode;
  user: User;
  workspace: Workspace;
}) {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border/70 bg-card/40 lg:block">
        <SidebarContent workspace={workspace} />
      </aside>
      <div className="lg:pl-72">
        <TopBar user={user} workspace={workspace} />
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ workspace }: { workspace: Workspace }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background">
            <BookOpenCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">AV-OKF</p>
            <p className="truncate text-xs text-muted-foreground">
              {workspace.plan}
            </p>
          </div>
        </Link>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navigation.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground",
                active && "bg-accent text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        <div className="mt-6 px-3 text-xs font-medium uppercase text-muted-foreground">
          Later stages
        </div>
        {futureNavigation.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/70"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </div>
        ))}
      </nav>
      <div className="border-t border-border/70 p-4">
        <div className="rounded-md border border-border bg-background/60 p-3">
          <p className="text-sm font-medium">{workspace.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {workspace.memberCount} members - Mock workspace
          </p>
        </div>
      </div>
    </div>
  );
}

function TopBar({ user, workspace }: { user: User; workspace: Workspace }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent workspace={workspace} />
          </SheetContent>
        </Sheet>
        <div className="hidden min-w-0 flex-col sm:flex">
          <span className="text-xs text-muted-foreground">Workspace</span>
          <span className="truncate text-sm font-medium">{workspace.name}</span>
        </div>
        <div className="relative ml-auto hidden w-full max-w-md md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            disabled
            className="h-9 bg-card/50 pl-9"
            placeholder="Search documents, tags, or future topics"
          />
        </div>
        <Button variant="ghost" size="icon">
          <Bell className="h-4 w-4" />
          <span className="sr-only">Notifications</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-10 gap-2 px-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback>{user.initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm md:inline">{user.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block text-sm">{user.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Mock profile</DropdownMenuItem>
            <DropdownMenuItem>Workspace access</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
