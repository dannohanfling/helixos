"use client";

import { useActionState } from "react";
import { loginAction, type AuthState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(loginAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label className="block">
        <span className="label">Email</span>
        <input className="field" name="email" type="email" autoComplete="email" required placeholder="you@example.com" defaultValue={state?.email ?? ""} />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="field" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <SubmitButton className="btn btn-brand w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
