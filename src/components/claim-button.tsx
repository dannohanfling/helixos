"use client";

import { useActionState } from "react";
import { claimRewardAction, type ClaimState } from "@/lib/actions/rewards";
import { SubmitButton } from "@/components/submit-button";

/** Claims one reward or prize. A refusal shows the server's reason in place; a grant re-renders the row with the booking link. */
export function ClaimButton({ name, label, className = "btn btn-accent btn-xs" }: { name: string; label: string; className?: string }) {
  const [state, action] = useActionState<ClaimState, FormData>(claimRewardAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-testid="claim-form">
      <input type="hidden" name="name" value={name} />
      <SubmitButton className={className} pendingText="Claiming…">
        {label}
      </SubmitButton>
      {state?.error ? (
        <span className="text-xs text-danger" data-testid="claim-error">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
