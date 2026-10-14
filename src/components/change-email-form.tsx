"use client";

import { useActionState } from "react";
import { changeEmailAction, confirmEmailChangeAction, type ConfirmEmailState, type EmailState } from "@/lib/actions/account";
import { EMAIL_CHANGE_CRM_NOTE } from "@/lib/engine/account";
import { SubmitButton } from "@/components/submit-button";

/** Settings → Login email (H-47): the new address and the current password; the change waits for the click in the new inbox. */
export function ChangeEmailForm({ current }: { current: string }) {
  const [state, action] = useActionState<EmailState, FormData>(changeEmailAction, undefined);
  return (
    <form action={action} className="space-y-3" data-testid="email-change">
      <p className="text-sm">
        You sign in as <b data-testid="email-current">{current}</b>.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">New email</span>
          <input className="field" name="email" type="email" required autoComplete="email" data-testid="email-new" />
        </label>
        <label className="block">
          <span className="label">Current password</span>
          <input className="field" name="current" type="password" required autoComplete="current-password" data-testid="email-password" />
        </label>
      </div>
      <p className="text-xs text-ink-3">A confirmation link goes to the new address and works for 24 hours; nothing changes until it&apos;s clicked. Your old address gets a heads-up. {EMAIL_CHANGE_CRM_NOTE}</p>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert" data-testid="email-error">{state.error}</p> : null}
      {state?.said ? (
        <p className="rounded-lg bg-good-soft px-3 py-2 text-sm" role="status" data-testid="email-said">
          {state.said}
          {state.devLink ? (
            <>
              {" "}
              <a href={state.devLink} className="underline" data-testid="email-dev-link">
                (dev: the link)
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="email-send">
        Send the confirmation link
      </SubmitButton>
    </form>
  );
}

/** The confirm page's one button: the click that makes the change. */
export function ConfirmEmailForm({ token, newMasked }: { token: string; newMasked: string }) {
  const [state, action] = useActionState<ConfirmEmailState, FormData>(confirmEmailChangeAction, undefined);
  if (state?.email)
    return (
      <p className="rounded-lg bg-good-soft px-3 py-2 text-sm" role="status" data-testid="email-confirmed">
        Done. From now on you sign in as <b>{state.email}</b>. {EMAIL_CHANGE_CRM_NOTE}
      </p>
    );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">Make {newMasked} the email you sign in with?</p>
      {state?.error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert" data-testid="email-confirm-error">{state.error}</p> : null}
      <SubmitButton className="btn btn-primary" pendingText="Confirming…" data-testid="email-confirm">
        Yes, use this email
      </SubmitButton>
    </form>
  );
}
