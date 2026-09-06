"use client";

import type { ReactNode } from "react";

/** A submit button that asks first. Works inside a server-action form: cancelling stops the submit, confirming lets it through. */
export function ConfirmButton({ message, className, title, children }: { message: string; className?: string; title?: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      className={className}
      title={title}
      aria-label={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
