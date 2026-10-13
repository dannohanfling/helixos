"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export type ProgressStep = { label: string; until: number; seconds: number };

/**
 * A thin gold 0 to 100% line for anything slow (H-10): the step's label and the percentage, honest about not knowing. With
 * real steps the caller sets `step`; without, the line eases through the steps' estimated seconds, rests near 90% and jumps
 * to 100% only when `done`. It never sits at 100% while still working. On failure it turns red with the error and Try again.
 */
export function ProgressLine({ active, done, error, steps, onRetry, testId = "progress-line" }: { active: boolean; done: boolean; error?: string | null; steps: ProgressStep[]; onRetry?: () => void; testId?: string }) {
  const [pct, setPct] = useState(0);
  // A new run starts from 0 (adjusted while rendering, as React recommends over an effect).
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setPct(0);
  }
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const total = steps.reduce((n, s) => n + s.seconds, 0) || 1;
    const t = setInterval(() => {
      const gone = (Date.now() - startedAt) / 1000;
      // Eases toward 90% over the estimate, then creeps; a slow run reads as slow, never as finished.
      const est = Math.min(0.9, gone / total) * 90 + Math.max(0, gone - total) * 0.15;
      setPct(Math.min(96, Math.round(est)));
    }, 400);
    return () => clearInterval(t);
  }, [active, steps]);
  // "Done" stays a moment, then the line goes, so the page doesn't keep a finished bar forever.
  const [hidden, setHidden] = useState(false);
  if (hidden && (!done || active)) setHidden(false);
  useEffect(() => {
    if (!done || active) return;
    const t = setTimeout(() => setHidden(true), 2500);
    return () => clearTimeout(t);
  }, [done, active]);
  const shown = done ? 100 : active ? pct : 0;
  const step = steps.find((s) => shown < s.until) ?? steps[steps.length - 1];
  if ((!active && !done && !error) || (done && hidden && !error)) return null;
  return (
    <div className="my-2 text-xs" role={error ? "alert" : "status"} aria-live="polite" data-testid={testId} data-pct={shown}>
      <div className="flex items-center justify-between gap-2">
        <span className={error ? "text-danger" : "text-ink-3"}>{error ? error : done ? "Done" : `${step?.label ?? "Working…"} ${shown}%`}</span>
        {error && onRetry ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-300 ${error ? "bg-danger" : "bg-accent"}`} style={{ width: `${error ? 100 : shown}%` }} />
      </div>
    </div>
  );
}

/** The same line under a plain form's submit: it runs while the form is pending and ends with the page's answer. */
export function FormProgress({ steps, testId }: { steps: ProgressStep[]; testId?: string }) {
  const { pending } = useFormStatus();
  return <ProgressLine active={pending} done={false} steps={steps} testId={testId} />;
}
