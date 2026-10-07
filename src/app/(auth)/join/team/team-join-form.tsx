"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { joinTeamAction, type AuthState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

/**
 * Joining a member's team (Danno, 6 Oct): the invitee's own name, email and password, the invite code riding hidden from the
 * link. No business name: the business is the owner's. Every box holds what was typed through a refusal.
 */
export function TeamJoinForm({ code }: { code: string }) {
  const [state, action] = useActionState<AuthState, FormData>(joinTeamAction, undefined);
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const mismatch = v.confirm.length > 0 && v.confirm !== v.password;
  const confirmBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    confirmBox.current?.setCustomValidity(mismatch ? "The two passwords don't match." : "");
  }, [mismatch]);

  return (
    <form action={action} className="space-y-3" data-testid="team-join-form">
      <input type="hidden" name="code" value={code} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">First name</span>
          <input className="field" name="firstName" value={v.firstName} onChange={set("firstName")} required maxLength={40} autoComplete="given-name" />
        </label>
        <label className="block">
          <span className="label">Last name</span>
          <input className="field" name="lastName" value={v.lastName} onChange={set("lastName")} required maxLength={40} autoComplete="family-name" />
        </label>
      </div>
      <label className="block">
        <span className="label">Email</span>
        <input className="field" name="email" type="email" value={v.email} onChange={set("email")} required autoComplete="email" />
      </label>
      <label className="block">
        <span className="flex items-center justify-between">
          <span className="label">Password</span>
          <button type="button" className="text-xs text-ink-2 underline" onClick={() => setShow((s) => !s)} aria-pressed={show}>
            {show ? "Hide passwords" : "Show passwords"}
          </button>
        </span>
        <input className="field" name="password" type={show ? "text" : "password"} value={v.password} onChange={set("password")} required minLength={8} autoComplete="new-password" />
        <span className="mt-0.5 block text-[11px] text-ink-3">At least 8 characters. Already have a HelixOS login? Use its email and password here and this team is added to it.</span>
      </label>
      <label className="block">
        <span className="label">Confirm password</span>
        <input className="field" name="confirm" type={show ? "text" : "password"} value={v.confirm} ref={confirmBox} onChange={set("confirm")} required minLength={8} autoComplete="new-password" aria-invalid={mismatch} />
        {mismatch ? <span className="mt-0.5 block text-xs text-danger">The two passwords don&apos;t match.</span> : null}
      </label>
      {state?.error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert" data-testid="team-join-error">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-brand w-full" pendingText="Joining…">
        Join the team
      </SubmitButton>
    </form>
  );
}
