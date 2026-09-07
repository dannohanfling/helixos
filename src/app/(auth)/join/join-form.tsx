"use client";

import { useActionState } from "react";
import { joinAction, type AuthState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export function JoinForm({ code }: { code?: string }) {
  // The browser knows the member's timezone; the server stores it so "today" and reminders follow the member, not the coach.
  const [state, action] = useActionState<AuthState, FormData>((prev, formData) => {
    try {
      formData.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    } catch {
      /* leave unset: the workspace timezone applies */
    }
    return joinAction(prev, formData);
  }, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Invite code</span>
        <input className="field uppercase tracking-widest" name="code" defaultValue={code ?? ""} required placeholder="ACADEMY1" />
      </label>
      <label className="block">
        <span className="label">Your name</span>
        <input className="field" name="name" required placeholder="Maya Torres" autoComplete="name" />
      </label>
      <label className="block">
        <span className="label">Business (optional)</span>
        <input className="field" name="businessName" placeholder="Torres Nutrition Coaching" />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="field" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="field" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <SubmitButton className="btn btn-brand w-full" pendingText="Creating your space…">
        Join and start Day 1
      </SubmitButton>
    </form>
  );
}
