"use client";

import { useActionState } from "react";
import { resetAction, type ResetState } from "@/lib/actions/account";
import { SubmitButton } from "@/components/submit-button";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState<ResetState, FormData>(resetAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="label">New password</span>
        <input className="field" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input className="field" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <SubmitButton className="btn btn-primary w-full" pendingText="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
