import { SubmitButton } from "@/components/submit-button";
import { acceptTargetAction } from "@/lib/actions/body";
import type { WorkoutRead } from "@/lib/engine/body-reads";

/**
 * The post-workout read (rev 471): a few plain lines about the session, each exercise against last time, and next time's weight
 * where it was earned, with "Use next time" to make it the routine's target. `compact` (Today) shows the lines and a link only.
 */
export function WorkoutReadCard({ read, date, unit, routineId, compact = false }: { read: WorkoutRead; date: string; unit: string; routineId: string | null; compact?: boolean }) {
  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm" data-testid="workout-read" data-care={read.care ? "1" : "0"}>
      <p className="text-xs font-semibold text-humanos-ink">How it went</p>
      <ul className="mt-1 space-y-0.5" data-testid="workout-read-lines">
        {read.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {compact ? null : (
        <>
          {read.exercises.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-3 underline">Each exercise against last time</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-2" data-testid="workout-read-exercises">
                {read.exercises.map((e) => (
                  <li key={e.exerciseId} data-trend={e.trend}>
                    {e.line}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {read.next.length ? (
            <div className="mt-2" data-testid="workout-read-next">
              <p className="text-xs font-medium text-ink-2">Next time</p>
              <ul className="mt-0.5 space-y-1 text-xs">
                {read.next.map((n) => (
                  <li key={n.exerciseId} className="flex flex-wrap items-center gap-2" data-testid="workout-read-next-item" data-exercise={n.exercise} data-weight={n.weight ?? ""} data-add={n.add ? "1" : "0"}>
                    <span>
                      {n.exercise}: {n.weight != null ? `${n.weight} ${unit}` : "the same"}
                      {n.reps ? ` × ${n.reps}` : ""} <span className="text-ink-3">({n.why})</span>
                    </span>
                    {routineId && n.weight != null ? (
                      <form action={acceptTargetAction}>
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="routineId" value={routineId} />
                        <input type="hidden" name="exerciseId" value={n.exerciseId} />
                        <input type="hidden" name="weight" value={n.weight} />
                        <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="workout-read-accept">
                          Use next time
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
