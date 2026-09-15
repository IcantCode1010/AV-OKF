"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function PendingSubmitButton({
  children,
  disabled = false,
  pendingLabel,
  ...buttonProps
}: Omit<ComponentProps<typeof Button>, "children" | "disabled" | "type"> & {
  children: ReactNode;
  disabled?: boolean;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button {...buttonProps} type="submit" disabled={disabled || pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
