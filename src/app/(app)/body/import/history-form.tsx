"use client";

import { useActionState, useState } from "react";
import { importHistoryAction, type HistoryState } from "@/lib/actions/body";
import { SubmitButton } from "@/components/submit-button";
import { Card, Disclosure, Stat } from "@/components/ui";
import { fmtSetLine } from "@/lib/engine/body-airtable";

const EMPTY = { base: "", token: "", from: "", notes: "1", dayTypesOnly: "0" };
type Fields = typeof EMPTY;

/**
 * The form holds every input, so the token pasted for the dry run is still in its box for Approve and goes nowhere else: not
 * into the address, not into the page the server sends back, not into the browser's saved form data. Change anything after a
 * dry run and Approve waits for a fresh one.
 */
export function HistoryForm({ ownHistory = false }: { ownHistory?: boolean }) {
  const [state, action] = useActionState<HistoryState, FormData>(importHistoryAction, undefined);
  const [f, setF] = useState<Fields>({ ...EMPTY, dayTypesOnly: ownHistory ? "1" : "0" });
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setDirty(false);
  }
  const set = (k: keyof Fields, value: string) => {
    setF({ ...f, [k]: value });
    setDirty(true);
  };
  const bind = (k: keyof Fields) => ({ name: k, value: f[k], onChange: (e: { target: { value: string } }) => set(k, e.target.value) });
  const p = state?.preview;
  const s = p?.summary;
  const canApprove = p && !dirty && (p.plan.dayTypesOnly ? s!.days > 0 : s!.weighIns + s!.sessions + s!.exercises + s!.routines > 0);

  return (
    <form action={action} className="space-y-4" data-testid="history-form" autoComplete="off">
      <Card title="Your base">
        <p className="mb-3 text-xs text-ink-3">A read-only token with this base on it. It is used for this run only: never saved, never logged, never shown back. Leave the page and it is gone. Only the Journal, Exercises and Routines tables are read.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Base id</span>
            <input className="field font-mono" {...bind("base")} required placeholder="appXXXXXXXXXXXXXX" spellCheck={false} data-testid="history-base" />
          </label>
          <label className="block">
            <span className="label">Token</span>
            <input className="field font-mono" type="password" {...bind("token")} required autoComplete="new-password" spellCheck={false} placeholder="pat…" data-testid="history-token" />
          </label>
          <label className="block">
            <span className="label">From (optional: leave earlier days out)</span>
            <input className="field" type="date" {...bind("from")} data-testid="history-from" />
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="hidden" name="notes" value={f.notes} />
            <input type="hidden" name="dayTypesOnly" value={f.dayTypesOnly} />
            <input type="checkbox" checked={f.notes === "1"} onChange={(e) => set("notes", e.target.checked ? "1" : "0")} data-testid="history-notes" />
            Read sets out of the Exercise Notes too (the words stay in Airtable)
          </label>
          <label className="flex items-start gap-2 text-sm" data-testid="history-day-types-label">
            <input type="checkbox" checked={f.dayTypesOnly === "1"} onChange={(e) => set("dayTypesOnly", e.target.checked ? "1" : "0")} data-testid="history-day-types" className="mt-0.5" />
            <span>
              Day types only
              <span className="block text-xs text-ink-3">{ownHistory ? "Your weigh-ins and workouts are already in HelixOS, so this is ticked: each day takes its day type from the Journal's routine, and nothing else is brought over (unticking it would double what's here)." : "Set each day's day type from the Journal's routine and bring nothing else over."}</span>
            </span>
          </label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="intent" value="dry" className="btn btn-soft" pendingText="Reading the base…" data-testid="history-dry">
          Dry run
        </SubmitButton>
        {p ? <input type="hidden" name="key" value={p.key} /> : null}
        {p ? (
          <SubmitButton name="intent" value="approve" className="btn btn-humanos" pendingText="Bringing it over…" disabled={!canApprove} data-testid="history-approve">
            Approve and bring it over
          </SubmitButton>
        ) : null}
        {p && dirty ? <span className="text-xs text-ink-3">You changed the form: run the dry run again first.</span> : null}
      </div>

      {state?.error ? (
        <p className="rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="history-error">
          {state.error}
        </p>
      ) : null}
      {state?.changed ? (
        <p className="rounded-xl border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="history-changed">
          The base changed since the dry run, so nothing was written. Here is the plan as it is now; Approve again if it&apos;s right.
        </p>
      ) : null}

      {p && s ? (
        <div className="space-y-4" data-testid="history-preview" data-days={s.days} data-weigh-ins={s.weighIns} data-sessions={s.sessions} data-sets={s.sets} data-exercises={s.exercises} data-routines={s.routines} data-skipped={s.skipped}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {p.plan.dayTypesOnly ? <Stat label="Day types" value={String(s.days)} sub="days that take a day type; nothing else is written" /> : null}
            <Stat label="Weigh-ins" value={String(s.weighIns)} sub={`${s.weighInsHave ? `${s.weighInsHave} already in · ` : ""}${s.skipped ? `${s.skipped} estimated or carried forward, left out` : "one a day, the newest reading"}`} />
            <Stat label="Workouts" value={String(s.sessions)} sub={`${s.sets} sets${s.sessionsHave ? ` · ${s.sessionsHave} days already in` : ""}${s.unread ? ` · ${s.unread} line${s.unread === 1 ? "" : "s"} it couldn't read` : ""}`} />
            <Stat label="Exercises" value={String(s.exercises)} sub="new names; the rest match yours" />
            <Stat label="Routines" value={String(s.routines)} sub="new; matched by name" />
          </div>
          {p.plan.missing.length ? <p className="text-xs text-warn">Not in this base: {p.plan.missing.join(", ")}. The rest is read.</p> : null}

          <Card title="Workouts, day by day">
            {p.plan.sessions.length ? (
              <ul className="divide-y text-sm" data-testid="history-sessions">
                {p.plan.sessions.map((d) => (
                  <li key={d.date} className="py-2" data-testid="history-session" data-date={d.date} data-status={d.status}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {d.date}
                        {d.routineName ? <span className="text-ink-2"> · {d.routineName}</span> : null}
                      </span>
                      <span className="text-xs text-ink-3">
                        {d.status === "have" ? "already has a workout, left as it is" : d.from === "table" ? "from the Exercises rows" : "read from the notes"}
                        {d.unread ? ` · ${d.unread} unread` : ""}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                      {d.exercises.map((e) => (
                        <li key={e.name}>
                          {e.name}: {e.sets.map(fmtSetLine).join(", ")}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No workouts found.</p>
            )}
          </Card>

          <Card title="Weigh-ins">
            {p.plan.weighIns.length ? (
              <Disclosure summary={<span className="text-sm underline">{p.plan.weighIns.length} days, {p.plan.weighIns[0].date} to {p.plan.weighIns[p.plan.weighIns.length - 1].date}</span>}>
                <ul className="mt-2 max-h-80 overflow-auto text-xs text-ink-2" data-testid="history-weigh-ins">
                  {p.plan.weighIns.map((w) => (
                    <li key={w.recordId} className="tabular" data-status={w.status}>
                      {w.date}: {w.values.weight} lb{w.values.bf != null ? `, ${w.values.bf}% body fat` : ""}
                      {w.status === "have" ? " · already in" : ""}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : (
              <p className="text-sm text-ink-3">No weigh-ins found.</p>
            )}
            {p.plan.skippedWeighIns.length ? <p className="mt-2 text-xs text-ink-3">Left out: {p.plan.skippedWeighIns.map((x) => `${x.date} (${x.why})`).join(", ")}.</p> : null}
          </Card>

          <Card title="Exercises and routines">
            <p className="text-sm" data-testid="history-exercises">
              {p.plan.exercises.length ? p.plan.exercises.map((e) => `${e.name}${e.status === "have" ? " (yours)" : ""}`).join(" · ") : "No exercises."}
            </p>
            <ul className="mt-2 space-y-1 text-sm" data-testid="history-routines">
              {p.plan.routines.map((r) => (
                <li key={r.name}>
                  <span className="font-medium">{r.name}</span>
                  {r.status === "have" ? <span className="text-xs text-ink-3"> · already yours</span> : null}
                  <span className="text-xs text-ink-2"> — {r.items.map((i) => `${i.exerciseName} ${i.sets} × ${i.reps}`).join(", ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </form>
  );
}
