import type { ReactNode } from "react";
import Link from "next/link";
import { ACCEPT_LABEL, CONTINUE_LABEL, REVIEW_LABEL, UNREVIEWED_LABEL, type Gate } from "@/lib/engine/provenance";
import { SubmitButton } from "@/components/submit-button";

/**
 * The provenance mark where the draft is chosen: a small "AI draft, not reviewed" beside an Accept for this one item. The
 * Accept is its own form (it sits beside the editor's form, never inside it) and accepts exactly this record: there is no
 * button anywhere that accepts more than one, because it would recreate the defect the mark exists to catch.
 */
export function UnreviewedMark({ action, fields, className = "" }: { action: (formData: FormData) => Promise<void>; fields: Record<string, string>; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="ai-unreviewed">
      <span className="rounded-md border border-warn bg-warn-soft px-2 py-0.5 text-xs font-medium">{UNREVIEWED_LABEL}</span>
      <form action={action}>
        {Object.entries(fields).map(([k, val]) => (
          <input key={k} type="hidden" name={k} value={val} />
        ))}
        <SubmitButton className="btn btn-ghost btn-xs" data-testid="ai-accept" pendingText="Accepting…">
          {ACCEPT_LABEL}
        </SubmitButton>
      </form>
    </div>
  );
}

/**
 * The gate, shown by the action that would send content out: the line naming how many AI drafts nobody reviewed, the drafts
 * by name, Review (back to the editor) or Continue anyway (the same action again with confirm=1, logged with who and when).
 */
export function GateBlock({ gate, reviewHref, action, fields, children }: { gate: Gate; reviewHref: string; action: (formData: FormData) => Promise<void>; fields: Record<string, string>; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-warn bg-warn-soft p-3 text-sm" data-testid="review-gate" role="alert">
      <p className="font-semibold" data-testid="review-gate-line">
        {gate.line}
      </p>
      <ul className="mt-1 list-disc pl-5" data-testid="review-gate-items">
        {gate.items.map((name, i) => (
          <li key={i}>{name}</li>
        ))}
      </ul>
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={reviewHref} className="btn btn-primary btn-sm" data-testid="review-gate-review">
          {REVIEW_LABEL}
        </Link>
        <form action={action}>
          {Object.entries({ ...fields, confirm: "1" }).map(([k, val]) => (
            <input key={k} type="hidden" name={k} value={val} />
          ))}
          <SubmitButton className="btn btn-ghost btn-sm" data-testid="review-gate-continue" pendingText="Saving…">
            {CONTINUE_LABEL}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
