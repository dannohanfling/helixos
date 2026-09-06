"use client";

import { useActionState } from "react";
import { forgotAction, type ForgotState } from "@/lib/actions/account";
import { SubmitButton } from "@/components/submit-button";

export function ForgotForm() {
  const [state, action] = useActionState<ForgotState, FormData>(forgotAction, undefined);
  if (state?.message) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-good-soft px-3 py-2 text-sm">{state.message}</p>
        {state.devLink ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
            Development only, no email was sent:{" "}
            <a href={state.devLink} className="underline" data-testid="dev-reset-link">
              open the reset link
            </a>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Email</span>
        <input className="field" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
      </label>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
