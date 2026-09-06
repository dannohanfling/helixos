"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "@/lib/actions/account";
import { SubmitButton } from "@/components/submit-button";

export function ChangePasswordForm() {
  const [state, action] = useActionState<PasswordState, FormData>(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Current password</span>
        <input className="field" name="current" type="password" required autoComplete="current-password" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">New password</span>
          <input className="field" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="label">Confirm</span>
          <input className="field" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </label>
      </div>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="rounded-lg bg-good-soft px-3 py-2 text-sm">Password changed. Every other device has been signed out.</p> : null}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
        Change password
      </SubmitButton>
    </form>
  );
}
