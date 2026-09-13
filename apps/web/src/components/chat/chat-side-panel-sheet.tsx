"use client";

import type { ReactNode } from "react";
import { PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function ChatSidePanelSheet({ children, label = "Sources & trace" }: { children: ReactNode; label?: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0 gap-2">
          <PanelRightOpen className="h-4 w-4" />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="overflow-y-auto p-4 pt-12 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetTitle className="sr-only">Sources and trace</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
