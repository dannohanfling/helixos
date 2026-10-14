"use client";

import { useActionState } from "react";
import { saveRungAction, type RungFormState } from "@/lib/actions/my-helix";
import type { RungDef } from "@/lib/engine/my-helix";
import { SubmitButton } from "@/components/submit-button";

/** One rung on Coach → My Helix rungs: name, order, link and the signal it reads, saved on its own. */
export function RungRow({ rung, signals }: { rung: RungDef; signals: { key: string; words: string }[] }) {
  const [state, action] = useActionState<RungFormState, FormData>(saveRungAction, null);
  return (
    <form action={action} className="grid gap-2 items-end md:grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]" data-testid="coach-helix-rung" data-key={rung.key}>
      <input type="hidden" name="key" value={rung.key} />
      <label className="block text-xs">
        Order
        <input className="field" name="order" type="number" min={1} defaultValue={rung.order} data-testid="rung-order" />
      </label>
      <label className="block text-xs">
        Rung
        <input className="field" name="label" defaultValue={rung.label} maxLength={80} required data-testid="rung-label" />
      </label>
      <label className="block text-xs">
        Link
        <input className="field" name="href" defaultValue={rung.href} data-testid="rung-href" />
      </label>
      <label className="block text-xs">
        Reads
        <select className="field" name="signal" defaultValue={rung.signal} data-testid="rung-signal">
          {signals.map((s) => (
            <option key={s.key} value={s.key}>
              {s.words}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="rung-save">
          Save
        </SubmitButton>
        {state?.error ? <span className="text-xs text-danger" role="alert">{state.error}</span> : null}
      </div>
    </form>
  );
}
