"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function TopicExpansionSelectionSubmit() {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const form = buttonRef.current?.closest("form");
    if (!form) return;
    const update = () => setSelectedCount(form.querySelectorAll<HTMLInputElement>('input[name="proposalIds"]:checked').length);
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, []);

  return (
    <Button disabled={pending || selectedCount === 0} ref={buttonRef} type="submit">
      {pending ? "Preparing estimate..." : selectedCount === 0 ? "Select topics to continue" : `Prepare estimate for ${selectedCount}`}
    </Button>
  );
}
