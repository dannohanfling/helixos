"use client";

import { useActionState, useState } from "react";
import { backfillAction, type BackfillState } from "@/lib/actions/backfill";
import { SubmitButton } from "@/components/submit-button";
import { Card, Disclosure, Stat } from "@/components/ui";
import { OMNICHANNEL_BASE } from "@/lib/engine/coach-backfill";

const EMPTY = { base: OMNICHANNEL_BASE, token: "" };
type Fields = typeof EMPTY;

/**
 * The form holds the token, so the one pasted for the dry run is still in its box for Approve and goes nowhere else: not into the
 * address, not into the page the server sends back, not into the browser's saved form data. Change anything after a dry run and
 * Approve waits for a fresh one.
 */
export function BackfillForm() {
  const [state, action] = useActionState<BackfillState, FormData>(backfillAction, undefined);
  const [f, setF] = useState<Fields>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setDirty(false);
  }
  const bind = (k: keyof Fields) => ({
    name: k,
    value: f[k],
    onChange: (e: { target: { value: string } }) => {
      setF({ ...f, [k]: e.target.value });
      setDirty(true);
    },
  });
  const p = state?.preview;
  const s = p?.summary;
  const canApprove = p && !dirty && s!.feedbackNew + s!.oohNew > 0;

  return (
    <form action={action} className="space-y-4" data-testid="backfill-form" autoComplete="off">
      <Card title="The base">
        <p className="mb-3 text-xs text-ink-3">
          A read-only token with this base on it. It is used for this run only: never saved, never logged, never shown back. Read: Client Feedback and Client Support, and only the email of each member in Fulfillment, to place each row on its member.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Base id</span>
            <input className="field font-mono" {...bind("base")} required spellCheck={false} data-testid="backfill-base" />
          </label>
          <label className="block">
            <span className="label">Token</span>
            <input className="field font-mono" type="password" {...bind("token")} required autoComplete="new-password" spellCheck={false} placeholder="pat…" data-testid="backfill-token" />
          </label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="intent" value="dry" className="btn btn-soft" pendingText="Reading the base…" data-testid="backfill-dry">
          Dry run
        </SubmitButton>
        {p ? <input type="hidden" name="key" value={p.key} /> : null}
        {p ? (
          <SubmitButton name="intent" value="approve" className="btn btn-primary" pendingText="Bringing it over…" disabled={!canApprove} data-testid="backfill-approve">
            Approve and bring it over
          </SubmitButton>
        ) : null}
        {p && dirty ? <span className="text-xs text-ink-3">You changed the form: run the dry run again first.</span> : null}
      </div>

      {state?.error ? (
        <p className="rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="backfill-error">
          {state.error}
        </p>
      ) : null}
      {state?.changed ? (
        <p className="rounded-xl border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="backfill-changed">
          The base changed since the dry run, so nothing was written. Here is the plan as it is now; Approve again if it&apos;s right.
        </p>
      ) : null}

      {p && s ? (
        <div className="space-y-4" data-testid="backfill-preview" data-feedback={s.feedbackNew} data-feedback-already={s.feedbackAlready} data-ooh={s.oohNew} data-ooh-already={s.oohAlready} data-skipped={s.skipped}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Monthly feedback" value={String(s.feedbackNew)} sub={s.feedbackAlready ? `${s.feedbackAlready} months already in, left as they are` : "months new to HelixOS"} />
            <Stat label="Office Hours" value={String(s.oohNew)} sub={s.oohAlready ? `${s.oohAlready} already brought over` : "requests new to HelixOS"} />
            <Stat label="Members" value={String(s.members)} sub="with something new" />
            <Stat label="Left out" value={String(s.skipped)} sub="listed below, with why" />
          </div>
          {p.missing.length ? <p className="text-xs text-warn">Not in this base: {p.missing.join(", ")}. The rest is read.</p> : null}
          {s.improveLeft ? <p className="text-xs text-ink-3">{s.improveLeft} feedback answer{s.improveLeft === 1 ? " has" : "s have"} an Improve answer too; HelixOS&apos;s form has no Improve question, so those stay in Airtable.</p> : null}

          <Card title="Monthly feedback">
            {p.feedback.length ? (
              <Disclosure summary={<span className="text-sm underline">{p.feedback.length} months, {p.feedback[0].month} to {p.feedback[p.feedback.length - 1].month}</span>}>
                <ul className="mt-2 max-h-80 overflow-auto text-xs text-ink-2" data-testid="backfill-feedback">
                  {p.feedback.map((x) => (
                    <li key={x.recordId} data-status={x.status}>
                      {x.month} · {x.who}
                      {x.status === "already" ? " · already in" : ""}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : (
              <p className="text-sm text-ink-3">No feedback found.</p>
            )}
          </Card>

          <Card title="Office Hours">
            {p.ooh.length ? (
              <Disclosure summary={<span className="text-sm underline">{p.ooh.length} requests, {p.ooh[0].friday} to {p.ooh[p.ooh.length - 1].friday}</span>}>
                <ul className="mt-2 max-h-80 overflow-auto text-xs text-ink-2" data-testid="backfill-ooh">
                  {p.ooh.map((x) => (
                    <li key={x.recordId} data-status={x.status}>
                      {x.friday} · {x.who} · {x.category}
                      {x.status === "already" ? " · already in" : ""}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : (
              <p className="text-sm text-ink-3">No requests found.</p>
            )}
          </Card>

          {p.skipped.length ? (
            <Card title="Left out">
              <ul className="space-y-0.5 text-xs text-ink-2" data-testid="backfill-skipped">
                {p.skipped.map((x) => (
                  <li key={x.recordId} data-testid="backfill-skip" data-why={x.why}>
                    {x.table} · {x.who}: {x.why}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
