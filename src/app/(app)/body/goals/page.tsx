import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Field, Progress } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { archiveGoalAction, logWaistAction, saveGoalAction } from "@/lib/actions/body";
import { goalPickers, goalsFor, lastWaist } from "@/lib/body-goals";
import { STATE_WORDS, fmtGoal, waistUnit } from "@/lib/engine/body-goals";
import { METRICS } from "@/lib/engine/body-scale";
import { bodySettingsFor, requireBodyEnabled } from "@/lib/queries/body";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "HumanOS · Health goals" };

const TONE = { done: "good", on_track: "good", a_little_behind: "accent", behind: "warn", no_data: "accent" } as const;
const KINDS = [
  { kind: "scale", label: "A number on the scale" },
  { kind: "waist", label: "Waist" },
  { kind: "lift", label: "A lift" },
  { kind: "habit", label: "A habit, days a week" },
  { kind: "training", label: "Workouts a week" },
  { kind: "sleep", label: "Average sleep" },
] as const;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string; saved?: string; waist?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const unit = settings.weightUnit;
  const [all, { exercises, habits }, waist] = await Promise.all([goalsFor(m, v.today, unit, { archived: true }), goalPickers(m), lastWaist(m)]);
  const live = all.filter((g) => !g.goal.archivedAt);
  const archived = all.filter((g) => g.goal.archivedAt);
  const lengthUnit = waistUnit(unit);
  return (
    <>
      <HumanosHeader title="Health goals" subtitle="Several at once, each paced on its 7-day average: what a week it needs, what it's done lately, and when it lands." />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : sp.saved || sp.waist ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="goals-saved">
          {sp.waist ? "Waist saved." : "Goal saved."}
        </p>
      ) : null}

      {live.length ? (
        <div className="mb-4 grid gap-3 md:grid-cols-2" data-testid="goals-list">
          {live.map(({ goal, title, line, status }) => (
            <section key={goal.id} className="card p-4" data-testid="goal-card" data-kind={goal.kind} data-state={status.state}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold" data-testid="goal-title">
                  {title}
                </div>
                <span className={`shrink-0 text-xs font-semibold ${status.state === "behind" ? "text-warn" : status.state === "on_track" || status.state === "done" ? "text-good" : "text-ink-3"}`} data-testid="goal-state">
                  {STATE_WORDS[status.state]}
                </span>
              </div>
              <div className="mt-2">
                <Progress value={Math.round(status.progress * 100)} tone={TONE[status.state]} height={6} />
              </div>
              <p className="mt-2 text-sm text-ink-2" data-testid="goal-line">
                {line}
              </p>
              <form action={archiveGoalAction} className="mt-2">
                <input type="hidden" name="id" value={goal.id} />
                <SubmitButton className="btn btn-ghost btn-xs text-ink-3" pendingText="…">
                  Archive
                </SubmitButton>
              </form>
            </section>
          ))}
        </div>
      ) : (
        <p className="card mb-4 p-4 text-sm text-ink-2">No goals yet. Set one below: a weight, your waist, a lift, a habit, workouts a week or sleep.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Set a goal" id="new">
          <form action={saveGoalAction} className="grid gap-3 sm:grid-cols-2" data-testid="goal-form">
            <Field label="What it's of">
              <select className="field" name="kind" defaultValue="scale" data-testid="goal-kind">
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Which (scale number, lift or habit)">
              <select className="field" name="metric" defaultValue="weight" data-testid="goal-metric">
                {METRICS.filter((x) => x.primary).map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select className="field mt-1" name="refId" defaultValue="" data-testid="goal-ref">
                <option value="">The lift or habit…</option>
                {exercises.length ? (
                  <optgroup label="Lifts">
                    {exercises.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {habits.length ? (
                  <optgroup label="Habits">
                    {habits.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </Field>
            <Field label={`Target (${unit} for a weight or lift, ${lengthUnit} for the waist, hours of sleep, days or workouts a week)`}>
              <input className="field" name="target" type="text" inputMode="decimal" autoComplete="off" required data-testid="goal-target" />
            </Field>
            <Field label="Reps (a lift)">
              <input className="field" name="reps" type="number" min={1} max={50} placeholder="5" data-testid="goal-reps" />
            </Field>
            <Field label="By (optional)">
              <input className="field" name="by" type="date" min={v.today} data-testid="goal-by" />
            </Field>
            <Field label="Start (optional; else today's 7-day average)">
              <input className="field" name="start" type="text" inputMode="decimal" autoComplete="off" placeholder="—" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton className="btn btn-humanos" pendingText="Saving…" data-testid="goal-save">
                Save the goal
              </SubmitButton>
              <p className="mt-2 text-xs text-ink-3">A date that asks for more than about 1% of bodyweight a week, or half a point of body fat, is called an aggressive pace, with a gentler date beside it.</p>
            </div>
          </form>
        </Card>

        <Card title="Waist" id="waist">
          <form action={logWaistAction} className="flex flex-wrap items-end gap-2" data-testid="waist-form">
            <label className="w-36">
              <span className="label">Day</span>
              <input name="date" type="date" defaultValue={v.today} max={v.today} className="field" required />
            </label>
            <label className="w-28">
              <span className="label">Waist ({lengthUnit})</span>
              <input name="waist" type="text" inputMode="decimal" autoComplete="off" className="field" required data-testid="waist-value" />
            </label>
            <SubmitButton className="btn btn-humanos" pendingText="Saving…" data-testid="waist-save">
              Save
            </SubmitButton>
          </form>
          <p className="mt-2 text-xs text-ink-3" data-testid="waist-last">
            {waist ? `Last: ${fmtGoal({ kind: "waist", key: "waist" }, waist.value, unit)} on ${formatDate(waist.date)}.` : "Measure at the navel, relaxed, the same time of day each time."}
          </p>
          <p className="mt-3 text-xs text-ink-3">
            The weight goal&apos;s line also shows on <Link href="/body/weight" className="underline">Weigh-ins</Link>.
          </p>
        </Card>
      </div>

      {archived.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-2">Archived ({archived.length})</summary>
          <ul className="mt-2 space-y-1" data-testid="goals-archived">
            {archived.map(({ goal, title }) => (
              <li key={goal.id} className="flex items-center justify-between gap-2">
                <span>{title}</span>
                <form action={archiveGoalAction}>
                  <input type="hidden" name="id" value={goal.id} />
                  <input type="hidden" name="back" value="1" />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                    Bring back
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
