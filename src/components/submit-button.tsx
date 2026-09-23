"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * The one pending button, for every form that sends something. From the moment it is pressed until the action answers it is
 * disabled and says it is working: its pending label ("Sending to your bot…", "Saving…", "Deleting…") and the small spinner
 * globals.css draws on any busy .btn. Every submit in the same form is disabled while it is out; only the pressed one changes
 * its label. useFormStatus reports the pending state once React has rendered it; the ref closes the gap before that render, so
 * a second press in the same instant (a double-click, a second tap on a phone) is dropped rather than sent twice. A press the
 * browser's own validation stops never counts as sent.
 */
export function SubmitButton({ children, className = "btn btn-primary", pendingText, disabled, onClick, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  const pressed = useRef(false);
  const [mine, setMine] = useState(false);
  const [wasPending, setWasPending] = useState(pending);
  // The send is over: this button is no longer the one that went. Adjusted while rendering, as React recommends over an effect.
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setMine(false);
  }
  useEffect(() => {
    // The action answered: the next press is a new send.
    if (!pending) pressed.current = false;
  }, [pending]);
  const busy = pending && mine;
  return (
    <button
      {...rest}
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={busy}
      data-pending={busy ? "true" : undefined}
      onClick={(e) => {
        if (pressed.current) {
          e.preventDefault();
          return;
        }
        const form = e.currentTarget.form;
        if (form && !form.checkValidity()) return;
        onClick?.(e);
        if (e.defaultPrevented) return;
        pressed.current = true;
        setMine(true);
      }}
    >
      {/* The spinner is the stylesheet's: every busy .btn draws one after its label. */}
      {busy ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
