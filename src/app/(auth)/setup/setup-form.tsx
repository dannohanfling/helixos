"use client";

import { useActionState } from "react";
import { setupAction, type SetupState } from "@/lib/actions/account";
import { SubmitButton } from "@/components/submit-button";

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Phoenix", "America/Toronto", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export function SetupForm({ token }: { token: string }) {
  const [state, action] = useActionState<SetupState, FormData>(setupAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="label">Workspace name</span>
        <input className="field" name="name" required placeholder="Evolve Omega Academy" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Your name</span>
          <input className="field" name="coachName" required autoComplete="name" />
        </label>
        <label className="block">
          <span className="label">Timezone</span>
          <select className="field" name="timezone" defaultValue="America/Los_Angeles">
            {TIMEZONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Coach email (your login)</span>
        <input className="field" name="coachEmail" type="email" required autoComplete="email" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Password</span>
          <input className="field" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="label">Confirm password</span>
          <input className="field" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </label>
      </div>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <SubmitButton className="btn btn-primary w-full" pendingText="Creating your workspace…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
