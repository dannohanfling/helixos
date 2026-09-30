import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { addDays, formatDate } from "@/lib/dates";
import { fmtSet, fmtTarget } from "@/lib/engine/body-training";
import { requireBodyEnabled, trainingDay, type TrainingDayView } from "@/lib/queries/body";
import { deleteSetAction, logSetAction, setDayOffAction, startSessionAction } from "@/lib/actions/body";

export const metadata = { title: "HumanOS · Training" };

/** One exercise in today's workout: target, PR, last time, today's sets, and the next set's form, thumb-sized. */
function ExerciseCard({ x, date, unit }: { x: TrainingDayView["exercises"][number]; date: string; unit: string }) {
  const bw = x.exercise.kind === "bodyweight";
  return (
    <section className="card p-4" data-testid="training-exercise" data-name={x.exercise.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/body/training/${x.exercise.id}`} className="font-semibold hover:underline">
          {x.exercise.name}
        </Link>
        <span className="text-xs text-ink-3">
          {x.target ? <span data-testid="training-target">{fmtTarget(x.target)}</span> : null}
          {x.target && x.pr ? " · " : null}
          {x.pr ? <span data-testid="training-pr">PR {x.pr.text}</span> : null}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-2" data-testid="training-last">
        {x.last.length ? (
          <>
            <span className="text-ink-3">Last time ({formatDate(x.lastDate!, { month: "short", day: "numeric" })}):</span> {x.last.join(" · ")}
          </>
        ) : (
          <span className="text-ink-3">First time: no sets before this.</span>
        )}
      </p>
      {x.today.length ? (
        <ol className="mt-2 flex flex-wrap gap-2" data-testid="training-sets">
          {x.today.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1 rounded-lg bg-humanos-soft px-2.5 py-1 text-sm tabular" data-testid="training-set" data-pr={s.pr ? "1" : "0"}>
              <span className="text-ink-3">{i + 1}.</span> {fmtSet(s, unit as "lb" | "kg", x.exercise.kind)}
              {s.pr ? <span title="A new PR">🏆</span> : null}
              <form action={deleteSetAction}>
                <input type="hidden" name="id" value={s.id} />
                <SubmitButton className="ml-1 text-ink-3 hover:text-danger" pendingText="…" aria-label={`Delete set ${i + 1}`} data-testid="training-delete-set">
                  ✕
                </SubmitButton>
              </form>
            </li>
          ))}
        </ol>
      ) : null}
      <form key={`${x.exercise.id}-${x.today.length}`} action={logSetAction} className="mt-3 flex flex-wrap items-end gap-2" data-testid="training-log-form">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="exerciseId" value={x.exercise.id} />
        <label className="w-24">
          <span className="label">{bw ? `Added (${unit})` : `Weight (${unit})`}</span>
          <input name="weight" type="number" step="any" min={0} inputMode="decimal" defaultValue={x.next.weight ?? ""} placeholder={bw ? "none" : ""} required={!bw} className="field py-2 text-base tabular sm:py-1 sm:text-sm" />
        </label>
        <span className="pb-2 text-ink-3" aria-hidden>
          ×
        </span>
        <label className="w-20">
          <span className="label">Reps</span>
          <input name="reps" type="number" step={1} min={1} inputMode="numeric" defaultValue={x.next.reps ?? ""} required className="field py-2 text-base tabular sm:py-1 sm:text-sm" />
        </label>
        <SubmitButton className="btn btn-humanos" pendingText="Logging…" data-testid="training-log-set">
          Log set
        </SubmitButton>
      </form>
    </section>
  );
}

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= v.today ? sp.date : v.today;
  const t = await trainingDay(v.workspace.id, v.user.id, date);
  if (!t) {
    return (
      <>
        <HumanosHeader title="Training" gear={false} />
        <Card>
          <p className="text-sm text-ink-2">
            Set up HumanOS first. <Link href="/body" className="font-medium underline">Go to Log →</Link>
          </p>
        </Card>
      </>
    );
  }
  const label = date === v.today ? "Today" : date === addDays(v.today, -1) ? "Yesterday" : formatDate(date, { weekday: "short", month: "short", day: "numeric" });
  const inView = new Set(t.exercises.map((x) => x.exercise.id));
  const others = t.library.exercises.filter((e) => !inView.has(e.id));

  return (
    <>
      <HumanosHeader
        title="Training"
        subtitle={t.dayType ? <span data-testid="training-day-type">{t.dayType.name}</span> : null}
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/body/training?date=${addDays(date, -1)}`} className="btn btn-ghost btn-sm" aria-label="Previous day">
              ←
            </Link>
            <span className="font-medium" data-testid="training-date">
              {label}
            </span>
            <Link href={`/body/training?date=${addDays(date, 1)}`} className={`btn btn-ghost btn-sm ${date >= v.today ? "pointer-events-none opacity-40" : ""}`} aria-label="Next day">
              →
            </Link>
          </div>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      {t.reminder ? (
        <p className="mb-4 rounded-lg bg-surface-2 p-2 text-sm" data-testid="training-reminder">
          📌 {t.reminder}
        </p>
      ) : null}

      {!t.library.exercises.length && !t.session ? (
        <Card title="Start here">
          <p className="text-sm text-ink-2" data-testid="training-empty">
            Add the exercises you do and group them into routines, then log each set here as weight × reps.{" "}
            <Link href="/body/training/routines" className="font-medium underline">
              Add your exercises →
            </Link>
          </p>
        </Card>
      ) : t.off ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3" data-testid="training-off">
            <p className="text-lg font-semibold text-humanos-ink">😴 {label === "Today" ? "Off today" : "Off"}. Rest is part of the plan.</p>
            <form action={setDayOffAction}>
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="off" value="0" />
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="training-undo-off">
                Not off after all
              </SubmitButton>
            </form>
          </div>
        </Card>
      ) : !t.session ? (
        <Card title={label === "Today" ? "Today's workout" : "Workout"}>
          <div className="space-y-3">
            {t.suggested ? (
              <form action={startSessionAction} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-humanos p-3">
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="routineId" value={t.suggested.id} />
                <div className="min-w-0">
                  <div className="font-semibold">{t.suggested.name}</div>
                  <div className="text-xs text-ink-3">{t.suggested.lines.map((l) => `${l.exercise.name} ${fmtTarget(l)}`).join(" · ")}</div>
                </div>
                <SubmitButton className="btn btn-humanos" pendingText="Starting…" data-testid="training-start-suggested">
                  Start {t.suggested.name}
                </SubmitButton>
              </form>
            ) : null}
            {t.library.routines.filter((r) => r.id !== t.suggested?.id).length ? (
              <ul className="divide-y rounded-lg border">
                {t.library.routines
                  .filter((r) => r.id !== t.suggested?.id)
                  .map((r) => (
                    <li key={r.id} className="p-2.5">
                      <form action={startSessionAction} className="flex flex-wrap items-center justify-between gap-2">
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="routineId" value={r.id} />
                        <div className="min-w-0 text-sm">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-ink-3">{r.lines.map((l) => l.exercise.name).join(" · ")}</div>
                        </div>
                        <SubmitButton className="btn btn-soft btn-sm" pendingText="Starting…" data-testid="training-start" data-name={r.name}>
                          Start
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
              </ul>
            ) : null}
            {!t.library.routines.length ? (
              <p className="text-sm text-ink-2">
                No routines yet. <Link href="/body/training/routines#routines" className="underline">Make one</Link> to start it in one tap, or log any exercise below.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <form action={setDayOffAction}>
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="off" value="1" />
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="training-mark-off">
                  😴 Mark {label === "Today" ? "today" : "this day"} Off
                </SubmitButton>
              </form>
            </div>
          </div>
        </Card>
      ) : (
        <p className="mb-3 text-sm text-ink-2" data-testid="training-session">
          <span className="font-semibold text-ink">{t.routineName ?? "Workout"}</span> · {t.exercises.reduce((a, x) => a + x.today.length, 0)} sets logged
        </p>
      )}

      {!t.off && (t.session || t.library.exercises.length) ? (
        <div className="mt-4 space-y-3">
          {t.exercises.map((x) => (
            <ExerciseCard key={x.exercise.id} x={x} date={date} unit={t.unit} />
          ))}
          {others.length ? (
            <Card title={t.exercises.length ? "Another exercise" : "Log an exercise"}>
              <form action={logSetAction} className="flex flex-wrap items-end gap-2" data-testid="training-add-exercise">
                <input type="hidden" name="date" value={date} />
                <label className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <span className="label">Exercise</span>
                  <select name="exerciseId" className="field py-2 text-base sm:py-1 sm:text-sm" required defaultValue="">
                    <option value="" disabled>
                      Pick an exercise…
                    </option>
                    {others.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-24">
                  <span className="label">Weight ({t.unit})</span>
                  <input name="weight" type="number" step="any" min={0} inputMode="decimal" className="field py-2 text-base tabular sm:py-1 sm:text-sm" />
                </label>
                <label className="w-20">
                  <span className="label">Reps</span>
                  <input name="reps" type="number" step={1} min={1} inputMode="numeric" required className="field py-2 text-base tabular sm:py-1 sm:text-sm" />
                </label>
                <SubmitButton className="btn btn-humanos" pendingText="Logging…" data-testid="training-add-log">
                  Log set
                </SubmitButton>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/body/training/routines" className="btn btn-ghost btn-sm" data-testid="training-routines-link">
          Exercises &amp; routines
        </Link>
      </div>
    </>
  );
}
