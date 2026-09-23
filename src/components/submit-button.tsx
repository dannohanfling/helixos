"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * The one pending button, for every form that sends something. From the moment it is pressed until the action answers it is
 * disabled and says it is working: its pending label ("Sending to your bot…", "Saving…", "Deleting…") and the small spinner
 * globals.css draws on any busy .btn.
 * useFormStatus reports the pending state once React has rendered it; the ref closes the gap before that render, so a second
 * press in the same instant (a double-click) is dropped rather than sent twice. A press that the browser's own validation
 * stops never counts as sent.
 */
export function SubmitButton({ children, className = "btn btn-primary", pendingText, disabled, onClick, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  const pressed = useRef(false);
  useEffect(() => {
    // The action answered: the next press is a new send.
    if (!pending) pressed.current = false;
  }, [pending]);
  return (
    <button
      {...rest}
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      onClick={(e) => {
        if (pressed.current) {
          e.preventDefault();
          return;
        }
        const form = e.currentTarget.form;
        if (form && !form.checkValidity()) return;
        onClick?.(e);
        if (!e.defaultPrevented) pressed.current = true;
      }}
    >
      {/* The spinner is the stylesheet's: every busy .btn draws one after its label. */}
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
