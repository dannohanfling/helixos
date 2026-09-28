"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { doneLabel, isErrorAnswer } from "@/lib/engine/done-label";
import { markField, refusalIn, restore, snapshot, type Snapshot } from "@/lib/form-keep";

/**
 * The press that is waiting for its answer. Module-level on purpose: an action that redirects shows the app's loading screen
 * for a moment, which unmounts the page and this button with it, so the answer is picked up by the button that comes back for
 * the same form (same page, same hidden fields, same place in the form). One press at a time is all a person makes.
 */
type Inflight = { key: string; snap: Snapshot | null; label: string | null; at: number; delivering?: boolean };
let inflight: Inflight | null = null;

function keyOf(button: HTMLButtonElement): string {
  const form = button.form;
  if (!form) return `${window.location.pathname}|noform`;
  // Next adds its own "$ACTION_…" fields while a form is being sent: they are not the form's, and not there afterwards.
  const own = (name: string) => Boolean(name) && !name.startsWith("$");
  const hidden = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'))
    .filter((i) => own(i.name))
    .map((i) => `${i.name}=${i.value}`)
    .join("&");
  const names = Array.from(form.elements)
    .map((e) => (e as HTMLInputElement).name)
    .filter(own)
    .join(",");
  const index = Array.from(form.querySelectorAll('button[type="submit"]')).indexOf(button);
  return `${window.location.pathname}|${hidden}|${names}|${index}`;
}

/**
 * Delivers the answer to the waiting press, on whichever button is on the page for it now: the one pressed, or its twin after
 * the loading screen. It waits (briefly) for that button to be there, then reads the address: a refusal puts back what was
 * typed and marks the field; a save tells the button to show its green.
 */
function deliver(tries = 0): void {
  const pressedFor = inflight;
  if (!pressedFor) return;
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).find((b) => keyOf(b) === pressedFor.key);
  if (!button) {
    if (tries < 40) setTimeout(() => deliver(tries + 1), 100);
    else inflight = null;
    return;
  }
  inflight = null;
  const form = button.form;
  if (isErrorAnswer(window.location.search)) {
    const refusal = refusalIn(window.location.search);
    if (form && pressedFor.snap) {
      restore(form, pressedFor.snap);
      if (refusal) markField(form, refusal.field, refusal.message);
    }
    return;
  }
  if (form) {
    form.querySelectorAll("[data-field-error]").forEach((n) => n.remove());
    window.dispatchEvent(new CustomEvent("helix:saved", { detail: { form } }));
  }
  if (pressedFor.label) window.dispatchEvent(new CustomEvent("helix:done", { detail: { key: pressedFor.key, label: pressedFor.label } }));
}
/** The answer is in: deliver it once the page has taken it (React resets a form after its action; this runs after that). */
function answered(): void {
  if (!inflight || inflight.delivering) return;
  inflight.delivering = true;
  setTimeout(() => deliver(), 80);
}

/**
 * The one pending button, for every form that sends something. From the moment it is pressed until the action answers it is
 * disabled and says it is working: its pending label ("Sending to your bot…", "Saving…", "Deleting…") and the small spinner
 * globals.css draws on any busy .btn. Every submit in the same form is disabled while it is out; only the pressed one changes
 * its label. useFormStatus reports the pending state once React has rendered it; the ref closes the gap before that render, so
 * a second press in the same instant (a double-click, a second tap on a phone) is dropped rather than sent twice. A press the
 * browser's own validation stops never counts as sent.
 *
 * When the answer comes (handoff revs 157 and 160): a save shows a short green confirmation beside the button ("Saved ✓",
 * "Sent ✓", from its working label) for about three seconds, announced to screen readers; a refusal (the address names an
 * error) keeps everything the member typed, puts the reason in red beside the field it names, and moves focus there.
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
  const sent = useRef(false);
  const self = useRef<HTMLButtonElement>(null);
  const [done, setDone] = useState<{ label: string; toast: boolean } | null>(null);

  // The same button saw its send through, or the page came back after the loading screen: either way the answer is in.
  useEffect(() => {
    // The action answered: the next press is a new send.
    if (!pending) pressed.current = false;
    if (pending || !sent.current) return;
    sent.current = false;
    answered();
  }, [pending]);
  useEffect(() => {
    // Once, on arriving.
    if (inflight && Date.now() - inflight.at < 60000) answered();
    // The green is shown by the button the answer lands on.
    let hide: ReturnType<typeof setTimeout> | undefined;
    const onDone = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; label: string }>).detail;
      if (!self.current || keyOf(self.current) !== d.key) return;
      // Beside the button when it can be seen; as a toast when the save folded it away (a set week's form sits under "Edit").
      setDone({ label: d.label, toast: !self.current.offsetParent || Boolean(self.current.closest("details:not([open])")) });
      clearTimeout(hide);
      hide = setTimeout(() => setDone(null), 3200);
    };
    window.addEventListener("helix:done", onDone);
    return () => {
      clearTimeout(hide);
      window.removeEventListener("helix:done", onDone);
    };
  }, []);

  const busy = pending && mine;
  return (
    <>
      <button
        {...rest}
        ref={self}
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
          sent.current = true;
          inflight = { key: keyOf(e.currentTarget), snap: form ? snapshot(form) : null, label: doneLabel(pendingText), at: Date.now() };
          // A draft of this form is now sent: it is saved, or a refusal puts it back. Either way it isn't a slip to restore.
          if (form) window.dispatchEvent(new CustomEvent("helix:sending", { detail: { form } }));
          setDone(null);
          setMine(true);
        }}
      >
        {/* The spinner is the stylesheet's: every busy .btn draws one after its label. */}
        {busy ? (pendingText ?? "Saving…") : children}
      </button>
      {done && !done.toast ? (
        <span role="status" aria-live="polite" className="ml-2 inline-block align-middle text-sm font-medium text-good" data-testid="save-confirm">
          {done.label}
        </span>
      ) : null}
      {done?.toast
        ? createPortal(
            <span role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-good px-4 py-2 text-sm font-medium text-surface shadow-lg md:bottom-8" data-testid="save-confirm">
              {done.label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
