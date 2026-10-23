"use client";

/**
 * "Same as last" (H-1790): fills this set's form with the matching set from last time, warm-up mark included. It only fills the
 * form; Log set still logs it, so a wrong tap costs nothing.
 */
export function SameAsLastButton({ weight, reps, warmup, label }: { weight: number | null; reps: number; warmup: boolean; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-soft min-h-11"
      data-testid="training-same-as-last"
      onClick={(e) => {
        const f = e.currentTarget.form;
        if (!f) return;
        const set = (name: string, v: string) => {
          const el = f.elements.namedItem(name);
          if (el instanceof HTMLInputElement) el.value = v;
        };
        set("weight", weight == null ? "" : String(weight));
        set("reps", String(reps));
        const w = f.elements.namedItem("warmup");
        if (w instanceof HTMLInputElement) w.checked = warmup;
      }}
    >
      Same as last: {label}
    </button>
  );
}
