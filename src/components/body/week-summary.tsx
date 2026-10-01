"use client";
import { useActionState } from "react";
import type { SummaryState } from "@/lib/actions/body";
import { SubmitButton } from "@/components/submit-button";

/** "Summarise this week" (rev 237 phase 15): one press, the week's numbers to the member's own AI, the paragraph shown here and not kept. */
export function WeekSummary({ action, monday }: { action: (prev: SummaryState, f: FormData) => Promise<SummaryState>; monday: string }) {
  const [state, run] = useActionState<SummaryState, FormData>(action, undefined);
  const current = state?.monday === monday ? state : undefined;
  return (
    <div className="mt-3" data-testid="week-summary">
      <form action={run} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="monday" value={monday} />
        <SubmitButton className="btn btn-ghost btn-sm" pendingText="Reading the numbers…" data-testid="week-summary-button">
          ✨ Summarise this week
        </SubmitButton>
        <span className="text-xs text-ink-3">Your own AI, the numbers only; nothing is saved.</span>
      </form>
      {current?.error ? (
        <p className="mt-2 rounded-xl border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="week-summary-error">
          {current.error}
        </p>
      ) : null}
      {current?.text ? (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-2 p-3 text-sm" data-testid="week-summary-text">
          {current.text}
        </p>
      ) : null}
    </div>
  );
}
