"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { joinAction, type AuthState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

/**
 * Sign-up (rev 387): first and last name, both required, joined into the one name every account already has; email; a password
 * and its confirmation, shown or hidden together, the mismatch said under the second box as it is typed and refused before
 * anything is sent. The business name is required and is the one Settings → Business shows and edits (rev 469). Every box holds what was typed
 * through a refusal (a wrong code, a used email), so nothing has to be typed twice.
 */
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
  // Held here, not in the boxes alone: React empties a form after its action answers, and a refusal must not cost the typing.
  const [v, setV] = useState({ code: code ?? "", firstName: "", lastName: "", businessName: "", email: "", password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const mismatch = v.confirm.length > 0 && v.confirm !== v.password;
  const confirmBox = useRef<HTMLInputElement>(null);
  // The browser refuses the send while the two differ (either box may be the one that changed), so a mismatch never reaches the server.
  useEffect(() => {
    confirmBox.current?.setCustomValidity(mismatch ? "The two passwords don't match." : "");
  }, [mismatch]);

  return (
    <form action={action} className="space-y-3" data-testid="join-form">
      <label className="block">
        <span className="label">Invite code</span>
        <input className="field uppercase tracking-widest" name="code" value={v.code} onChange={set("code")} required placeholder="ACADEMY1" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">First name</span>
          <input className="field" name="firstName" value={v.firstName} onChange={set("firstName")} required maxLength={40} placeholder="Maya" autoComplete="given-name" />
        </label>
        <label className="block">
          <span className="label">Last name</span>
          <input className="field" name="lastName" value={v.lastName} onChange={set("lastName")} required maxLength={40} placeholder="Torres" autoComplete="family-name" />
        </label>
      </div>
      <label className="block">
        <span className="label">Business name</span>
        <input className="field" name="businessName" value={v.businessName} onChange={set("businessName")} required maxLength={120} placeholder="Torres Nutrition Coaching" autoComplete="organization" />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="field" name="email" type="email" value={v.email} onChange={set("email")} required autoComplete="email" />
      </label>
      <label className="block">
        <span className="flex items-center justify-between">
          <span className="label">Password</span>
          <button type="button" className="text-xs text-ink-2 underline" onClick={() => setShow((s) => !s)} aria-pressed={show} data-testid="join-show-password">
            {show ? "Hide passwords" : "Show passwords"}
          </button>
        </span>
        <input className="field" name="password" type={show ? "text" : "password"} value={v.password} onChange={set("password")} required minLength={8} autoComplete="new-password" />
        <span className="mt-0.5 block text-[11px] text-ink-3">At least 8 characters.</span>
      </label>
      <label className="block">
        <span className="label">Confirm password</span>
        <input
          className="field"
          name="confirm"
          type={show ? "text" : "password"}
          value={v.confirm}
          ref={confirmBox}
          onChange={set("confirm")}
          required
          minLength={8}
          autoComplete="new-password"
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "join-mismatch" : undefined}
        />
        {mismatch ? (
          <span id="join-mismatch" className="mt-0.5 block text-xs text-danger" data-testid="join-mismatch">
            The two passwords don&apos;t match.
          </span>
        ) : null}
      </label>
      {state?.error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert" data-testid="join-error">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-brand w-full" pendingText="Creating your space…">
        Join and start Day 1
      </SubmitButton>
    </form>
  );
}
