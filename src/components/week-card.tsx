import type { WeeklyIntention } from "@/db/schema";
import { reviewIntentionAction, saveIntentionAction } from "@/lib/actions/intentions";
import { intentionPrompt, keyResultTally } from "@/lib/engine/intentions";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";

type Sp = { weekError?: string; weekSaved?: string; weekReviewed?: string };

/** The 3-1-3 form, empty to set the week or filled to edit it. The third key result and the third task may stay blank. */
function WeekForm({ week }: { week: WeeklyIntention | null }) {
  const kr = (i: number) => week?.keyResults[i]?.text ?? "";
  const task = (i: number) => week?.tasks[i]?.title ?? "";
  return (
    <form action={saveIntentionAction} className="space-y-3" data-testid="week-form">
      <label className="block text-sm font-medium">
        ONE word to embody this week
        <input className="field mt-1" name="word" defaultValue={week?.word ?? ""} placeholder="Consistent" data-testid="week-word" />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">THREE key results you can track</legend>
        {[0, 1, 2].map((i) => (
          <input key={i} className="field" name={`kr${i + 1}`} defaultValue={kr(i)} placeholder={i === 2 ? "A third, if you have one" : ["Book 5 calls", "Post 5 times"][i]} data-testid={`week-kr${i + 1}`} />
        ))}
      </fieldset>
      <label className="block text-sm font-medium">
        ONE initiative toward your bigger goal
        <input className="field mt-1" name="initiative" defaultValue={week?.initiative ?? ""} placeholder="Finish my webinar slides" data-testid="week-initiative" />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">THREE tasks that move the needle</legend>
        {[0, 1, 2].map((i) => (
          <input key={i} className="field" name={`task${i + 1}`} defaultValue={task(i)} placeholder={i === 2 ? "A third, if you have one" : ["Follow up with 10 leads", "Record 2 videos"][i]} data-testid={`week-task${i + 1}`} />
        ))}
        <p className="text-xs text-ink-3">These become this week&apos;s tasks, due Friday, so you tick them off where you already work.</p>
      </fieldset>
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="week-save">
        {week ? "Save changes" : "Set my week"}
      </SubmitButton>
    </form>
  );
}

/**
 * The weekly 3-1-3 on Today (handoff rev 124): "Set your week" until it is set, then the week at the top. From Friday to Sunday
 * it asks, once, which key results got done.
 */
export function WeekCard({ week, today, taskDone, sp }: { week: WeeklyIntention | null; today: string; taskDone: Record<string, boolean>; sp: Sp }) {
  const state = intentionPrompt(today, week);
  const notes = (
    <>
      {sp.weekError ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="week-error">{sp.weekError}</p> : null}
      {sp.weekSaved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="week-saved">Your week is set. Your tasks are on your list, due Friday.</p> : null}
      {sp.weekReviewed ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="week-reviewed">Marked. See you Monday.</p> : null}
    </>
  );
  if (state === "set" || !week) {
    return (
      <section id="week" className="mb-5" data-testid="week-card" data-state="set">
        <Card title="Set your week" action={<Badge tone="accent">3-1-3</Badge>}>
          {notes}
          <p className="mb-3 text-sm text-ink-2">Choose ONE word to embody this week, then THREE key results you can track, ONE initiative toward your bigger goal, and THREE tasks that move the needle.</p>
          <WeekForm week={null} />
        </Card>
      </section>
    );
  }
  const reviewed = Boolean(week.reviewedAt);
  return (
    <section id="week" className="mb-5" data-testid="week-card" data-state={state}>
      <Card title={`Your week of ${formatDate(week.weekOf, { month: "short", day: "numeric" })}`} action={<Badge tone="accent">{reviewed ? keyResultTally(week.keyResults.map((k) => k.done)) : "3-1-3"}</Badge>}>
        {notes}
        <div className="text-2xl font-bold tracking-tight" data-testid="week-word-shown">{week.word}</div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Key results</div>
            <ul className="mt-1 space-y-1" data-testid="week-key-results">
              {week.keyResults.map((k, i) => (
                <li key={i} data-testid="week-key-result" data-done={k.done === null ? "unmarked" : k.done ? "yes" : "no"}>
                  {k.done === true ? "✓ " : k.done === false ? "✗ " : ""}
                  {k.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Initiative</div>
            <p className="mt-1" data-testid="week-initiative-shown">{week.initiative}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Tasks</div>
            <ul className="mt-1 space-y-1" data-testid="week-tasks">
              {week.tasks.map((t, i) => (
                <li key={i} data-testid="week-task" data-done={t.taskId && taskDone[t.taskId] ? "yes" : "no"}>
                  {t.taskId && taskDone[t.taskId] ? "✓ " : ""}
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {state === "review" ? (
          <form action={reviewIntentionAction} className="mt-4 rounded-lg border p-3" data-testid="week-review">
            <p className="mb-2 text-sm font-medium">The week is nearly done. Which key results did you hit?</p>
            <ul className="space-y-2 text-sm">
              {week.keyResults.map((k, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">{k.text}</span>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`kr${i + 1}`} value="done" data-testid={`week-review-kr${i + 1}-done`} /> Done
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`kr${i + 1}`} value="not" data-testid={`week-review-kr${i + 1}-not`} /> Not done
                  </label>
                </li>
              ))}
            </ul>
            <SubmitButton className="btn btn-primary btn-sm mt-3" pendingText="Saving…" data-testid="week-review-save">
              Mark my week
            </SubmitButton>
          </form>
        ) : null}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-3" data-testid="week-edit">Edit this week</summary>
          <div className="mt-3">
            <WeekForm week={week} />
          </div>
        </details>
      </Card>
    </section>
  );
}
