"use client";

import { useActionState } from "react";
import { saveSetupStepAction, type SetupFormState } from "@/lib/actions/setup";
import { SETUP_GROUPS, type SetupStepDef } from "@/lib/engine/setup";
import { SubmitButton } from "@/components/submit-button";

/** One step on Coach → Setup steps: name, group, order, link, what it reads, what it needs first, minutes; saved on its own. */
export function SetupStepRow({ step, signals }: { step: SetupStepDef; signals: { key: string; words: string }[] }) {
  const [state, action] = useActionState<SetupFormState, FormData>(saveSetupStepAction, null);
  return (
    <form action={action} className="grid gap-2 items-end md:grid-cols-[56px_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_56px_auto]" data-testid="coach-setup-step" data-key={step.key}>
      <input type="hidden" name="key" value={step.key} />
      <label className="block text-xs">
        Order
        <input className="field" name="order" type="number" min={1} defaultValue={step.order} data-testid="setup-order" />
      </label>
      <label className="block text-xs">
        Step ({step.key.toUpperCase()})
        <input className="field" name="label" defaultValue={step.label} maxLength={120} required data-testid="setup-label" />
      </label>
      <label className="block text-xs">
        Group
        <select className="field" name="group" defaultValue={step.group} data-testid="setup-group">
          {SETUP_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        Link
        <input className="field" name="href" defaultValue={step.href} data-testid="setup-href" />
      </label>
      <label className="block text-xs">
        Reads
        <select className="field" name="signal" defaultValue={step.signal} data-testid="setup-signal">
          {signals.map((s) => (
            <option key={s.key} value={s.key}>
              {s.words}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        Needs first
        <input className="field" name="needs" defaultValue={step.needs.join(", ")} placeholder="s1, s7" data-testid="setup-needs" />
      </label>
      <label className="block text-xs">
        Min
        <input className="field" name="minutes" type="number" min={0} max={600} defaultValue={step.minutes} data-testid="setup-minutes" />
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="setup-save">
          Save
        </SubmitButton>
        {state?.error ? (
          <span className="text-xs text-danger" role="alert">
            {state.error}
          </span>
        ) : state?.ok ? (
          <span className="text-xs text-good" role="status" data-testid="setup-saved">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
