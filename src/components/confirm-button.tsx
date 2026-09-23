"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

/**
 * A submit button that asks first. Works inside a server-action form: cancelling stops the submit, confirming lets it through
 * and the button then shows it is working, like every other send.
 */
export function ConfirmButton({ message, className, title, pendingText = "Working…", children }: { message: string; className?: string; title?: string; pendingText?: string; children: ReactNode }) {
  return (
    <SubmitButton
      className={className}
      title={title}
      aria-label={title}
      pendingText={pendingText}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </SubmitButton>
  );
}
