"use client";

import { useActionState } from "react";
import { adjustPointsAction, type AdjustState } from "@/lib/actions/coach";
import { SubmitButton } from "@/components/submit-button";

/** The coach's points correction or grant. The reason is typed each time: it is what the client reads. */
export function AdjustPointsForm({ membershipId }: { membershipId: string }) {
  const [state, action] = useActionState<AdjustState, FormData>(adjustPointsAction, undefined);
  return (
    <form action={action} className="space-y-2" data-testid="adjust-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <label className="block">
          <span className="label">Points</span>
          <input className="field tabular" name="points" type="number" step={1} min={-5000} max={5000} required placeholder="+250 or -40" />
        </label>
        <label className="block">
          <span className="label">Reason (the client reads this)</span>
          <input className="field" name="reason" required maxLength={200} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className="btn btn-soft btn-sm" pendingText="Recording…">
          Adjust points
        </SubmitButton>
        {state?.error ? (
          <span className="text-xs text-danger" data-testid="adjust-error">
            {state.error}
          </span>
        ) : null}
        {state?.ok ? (
          <span className="text-xs text-good" data-testid="adjust-ok">
            {state.ok}
          </span>
        ) : null}
      </div>
    </form>
  );
}
