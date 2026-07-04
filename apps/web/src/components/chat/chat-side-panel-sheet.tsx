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

export function ChatSidePanelSheet({ children }: { children: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 lg:hidden">
          <PanelRightOpen className="h-4 w-4" />
          Sources &amp; trace
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 overflow-y-auto p-4">
        <SheetTitle className="sr-only">Sources and trace</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
