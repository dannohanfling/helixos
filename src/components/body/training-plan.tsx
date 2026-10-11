import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/dates";
import { fmtTarget } from "@/lib/engine/body-training";
import { typeLabel } from "@/lib/engine/body-plan";
import type { PlannedDay, routinePreview } from "@/lib/queries/body";
import { setDayOffAction, setPlanDayAction, startSessionAction, swapPlanDaysAction } from "@/lib/actions/body";

type Preview = Awaited<ReturnType<typeof routinePreview>>;

/** What a day holds, in a word or two: the routine, Rest, or "nothing planned" on a lift day with no routine to give it. */
export const routineLabel = (d: PlannedDay) => d.name ?? (d.lift ? "Nothing planned" : "Rest");

/**
 * Training's Today card (rev 648): today's day type and routine, and either its exercises ready to start, the session's progress,
 * "Done · Back Day · 22 sets · 2 PRs", or a rest day with the habits due.
 */
export function TodayPlanCard({ day, preview, unit, prs, habits }: { day: PlannedDay; preview: Preview | null; unit: string; prs: number; habits: { id: string; name: string; kept: boolean }[] }) {
  const done = day.why === "done";
  return (
    <section className="card mb-3 border-humanos p-4" data-testid="training-today" data-why={day.why} data-routine={day.name ?? ""} data-lift={day.lift ? "1" : "0"}>
      <h2 className="text-lg font-semibold text-humanos-ink" data-testid="training-today-title">
        {done ? `Done · ${day.name ?? "Workout"} · ${day.sets} set${day.sets === 1 ? "" : "s"}${prs ? ` · ${prs} PR${prs === 1 ? "" : "s"}` : ""}` : `Today · ${typeLabel(day)} · ${routineLabel(day)}`}
      </h2>
      {day.carried ? (
        <p className="mt-1 text-xs text-warn" data-testid="training-today-carried">
          Legs missed last weekend.
        </p>
      ) : null}
      {done ? (
        <p className="mt-1 text-sm">
          <a href="#workout-read" className="underline" data-testid="training-today-read">
            The post-workout read ↓
          </a>
        </p>
      ) : day.why === "started" ? (
        <p className="mt-1 text-sm text-ink-2">
          Going: {day.sets} set{day.sets === 1 ? "" : "s"} so far. Log the next one below.
        </p>
      ) : !day.lift ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-ink-2">No workout today.</p>
          {habits.length ? (
            <ul className="flex flex-wrap gap-2" data-testid="training-today-habits">
              {habits.map((h) => (
                <li key={h.id} className={`rounded-full px-2.5 py-1 text-xs ${h.kept ? "bg-humanos-soft text-humanos-ink" : "bg-surface-2 text-ink-2"}`}>
                  {h.kept ? "✓ " : ""}
                  {h.name}
                </li>
              ))}
              <li>
                <Link href="/body/practices" className="text-xs text-ink-2 underline">
                  Practices
                </Link>
              </li>
            </ul>
          ) : null}
          {day.offByHand ? (
            <form action={setDayOffAction}>
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="off" value="0" />
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="training-undo-off">
                Not off after all
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : day.routine && preview ? (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-ink-3" data-testid="training-today-meta">
            {day.exercises} exercise{day.exercises === 1 ? "" : "s"}
            {day.muscles.length ? ` · ${day.muscles.join(" · ")}` : ""}
            {day.minutes ? ` · about ${day.minutes} min` : ""}
          </p>
          <ol className="divide-y rounded-lg border" data-testid="training-today-exercises">
            {preview.map((x, i) => (
              <li key={`${x.exercise.id}-${i}`} className="p-2.5 text-sm" data-testid="training-today-exercise" data-name={x.exercise.name}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">
                    <span className="text-ink-3">{i + 1}.</span> {x.exercise.name}
                  </span>
                  <span className="text-xs text-ink-2 tabular">
                    {fmtTarget(x)}
                    {x.weight != null ? <span data-testid="training-today-weight"> · next {x.weight} {unit}</span> : null}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {x.last.length ? `Last time (${formatDate(x.lastDate!, { month: "short", day: "numeric" })}): ${x.last.join(" · ")}` : "First time"}
                  {x.pr ? ` · PR ${x.pr}` : ""}
                </div>
              </li>
            ))}
          </ol>
          <form action={startSessionAction}>
            <input type="hidden" name="date" value={day.date} />
            <input type="hidden" name="routineId" value={day.routine.id} />
            <SubmitButton className="btn btn-humanos w-full sm:w-auto" pendingText="Starting…" data-testid="training-today-start">
              Start {day.routine.name}
            </SubmitButton>
          </form>
        </div>
      ) : (
        <p className="mt-1 text-sm text-ink-2">
          Nothing in the rotation for today.{" "}
          <Link href="/body/settings#training-plan" className="underline">
            Training plan
          </Link>
        </p>
      )}
    </section>
  );
}

/** A day that can still change: a lift day with a routine and nothing logged. */
const changeable = (d: PlannedDay) => d.lift && d.why !== "done" && d.why !== "started";

/**
 * The next 7 days (rev 648), a line each: the weekday and date, day type, routine or Rest, its exercise count and main muscles.
 * Open a day for its exercises, to do another routine that day, swap it with another day, or put it back to the plan.
 */
export function WeekPlanList({ days, routines }: { days: PlannedDay[]; routines: { id: string; name: string }[] }) {
  const swappable = days.filter((d) => changeable(d) && d.routineId);
  return (
    <section className="card mb-3 p-4" id="week-plan">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Next 7 days</h2>
        <Link href="/body/settings#training-plan" className="text-xs text-ink-2 hover:underline" data-testid="training-plan-settings">
          Training plan
        </Link>
      </div>
      <ul className="divide-y" data-testid="training-week-plan">
        {days.map((d, i) => (
          <li key={`${d.date}-${d.routineId}-${d.why}`} data-testid="training-plan-day" data-date={d.date} data-routine={d.name ?? ""} data-why={d.why} data-lift={d.lift ? "1" : "0"}>
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 [&::-webkit-details-marker]:hidden">
                <span className="w-24 shrink-0 text-sm font-medium">
                  {i === 0 ? "Today" : formatDate(d.date, { weekday: "short" })} <span className="text-xs font-normal text-ink-3">{formatDate(d.date, { month: "short", day: "numeric" })}</span>
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className={d.lift ? "font-medium" : "text-ink-2"}>{routineLabel(d)}</span>
                  {d.why === "done" ? <span className="text-humanos-ink"> ✓</span> : null}
                  {d.picked && d.why === "swap" ? <span className="text-xs text-ink-3"> · by hand</span> : null}
                  {d.carried ? <span className="text-xs text-warn"> · missed last weekend</span> : null}
                  <span className="text-xs text-ink-3"> · {typeLabel(d)}</span>
                </span>
                {d.routine ? (
                  <span className="text-xs text-ink-3" data-testid="training-plan-day-meta">
                    {d.exercises} exercise{d.exercises === 1 ? "" : "s"}
                    {d.muscles.length ? ` · ${d.muscles.join(" · ")}` : ""}
                  </span>
                ) : null}
              </summary>
              <div className="space-y-3 pb-3 text-sm">
                {d.routine ? (
                  <ol className="list-decimal space-y-0.5 pl-5 text-ink-2" data-testid="training-plan-day-exercises">
                    {d.routine.lines.map((l, j) => (
                      <li key={`${l.exerciseId}-${j}`}>
                        {l.exercise.name} <span className="text-xs text-ink-3">{fmtTarget(l)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-ink-3">{d.lift ? "Nothing in the rotation for this day." : "A rest day."}</p>
                )}
                {changeable(d) ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <form action={setPlanDayAction} className="flex items-end gap-2">
                      <input type="hidden" name="date" value={d.date} />
                      <label>
                        <span className="label">Do another routine</span>
                        <select name="routineId" className="field py-1 text-sm" defaultValue={d.routineId ?? ""} required data-testid="training-plan-pick">
                          <option value="" disabled>
                            Pick…
                          </option>
                          {routines.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton className="btn btn-soft btn-sm" pendingText="…" data-testid="training-plan-pick-save">
                        Use
                      </SubmitButton>
                    </form>
                    {d.routineId && swappable.length > 1 ? (
                      <form action={swapPlanDaysAction} className="flex items-end gap-2">
                        <input type="hidden" name="date" value={d.date} />
                        <label>
                          <span className="label">Swap with another day</span>
                          <select name="with" className="field py-1 text-sm" required defaultValue="" data-testid="training-plan-swap-with">
                            <option value="" disabled>
                              Pick a day…
                            </option>
                            {swappable
                              .filter((o) => o.date !== d.date)
                              .map((o) => (
                                <option key={o.date} value={o.date}>
                                  {formatDate(o.date, { weekday: "short", month: "short", day: "numeric" })} · {o.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <SubmitButton className="btn btn-soft btn-sm" pendingText="…" data-testid="training-plan-swap">
                          Swap
                        </SubmitButton>
                      </form>
                    ) : null}
                    {d.picked ? (
                      <form action={setPlanDayAction}>
                        <input type="hidden" name="date" value={d.date} />
                        <input type="hidden" name="routineId" value="" />
                        <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" data-testid="training-plan-reset">
                          Back to the plan
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
