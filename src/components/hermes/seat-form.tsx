"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { registerSeatAction } from "@/lib/hermes/register-action";

/**
 * The seat form. A personal page fills it on the server from the Magic funnel's own row (never from the URL); "Not you? Clear
 * the form" empties it, and a different email then registers as a new sign-up. It sends with the
 * server action registerSeatAction and the shared SubmitButton (disabled and "Saving your seat…" while it goes).
 */
export function SeatForm(props: { code: string | null; webinarId: string | null; prefill: { firstName: string; email: string; phone: string } | null; cta: string; sub: string; error: string | null; preview?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [filled, setFilled] = useState(Boolean(props.prefill));
  const clear = () => {
    const f = form.current;
    if (!f) return;
    for (const name of ["firstName", "email", "phone"]) {
      const el = f.elements.namedItem(name);
      if (el instanceof HTMLInputElement) el.value = "";
    }
    setFilled(false);
    (f.elements.namedItem("firstName") as HTMLInputElement | null)?.focus();
  };
  return (
    <form ref={form} className="hm-form" action={props.preview ? undefined : registerSeatAction} onSubmit={(e) => (props.preview ? e.preventDefault() : undefined)} data-testid="hm-form">
      {props.code ? <input type="hidden" name="code" value={props.code} /> : null}
      {props.webinarId ? <input type="hidden" name="webinar" value={props.webinarId} /> : null}
      {props.error ? (
        <p className="hm-error" role="alert" data-testid="hm-form-error">
          {props.error}
        </p>
      ) : null}
      <label>
        First name
        <input type="text" name="firstName" required maxLength={40} autoComplete="given-name" placeholder="Your first name" defaultValue={props.prefill?.firstName ?? ""} />
      </label>
      <label>
        Email
        <input type="email" name="email" required maxLength={254} autoComplete="email" inputMode="email" placeholder="you@yourbusiness.com" defaultValue={props.prefill?.email ?? ""} />
      </label>
      <label>
        Mobile
        <input type="tel" name="phone" maxLength={30} autoComplete="tel" inputMode="tel" placeholder="Your mobile" defaultValue={props.prefill?.phone ?? ""} />
      </label>
      <SubmitButton className="hm-cta" pendingText="Saving your seat…" data-testid="hm-submit">
        <span className="hm-cta-label">{`${props.cta} →`}</span>
        <span className="hm-cta-sub">{props.sub}</span>
      </SubmitButton>
      {filled ? (
        <p className="hm-formnote">
          Filled in from our Messenger chat.{" "}
          <button type="button" className="hm-linkbtn" onClick={clear} data-testid="hm-clear">
            Not you? Clear the form
          </button>
        </p>
      ) : (
        <p className="hm-formnote">We only use this to send your join link and a reminder.</p>
      )}
    </form>
  );
}
