import type { WeeklyIntention } from "@/db/schema";
import { reviewIntentionAction, saveIntentionAction } from "@/lib/actions/intentions";
import { intentionPrompt, keyResultTally, krProgress, targetOf } from "@/lib/engine/intentions";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";
import { ShareButton } from "@/components/share-button";
import { WeekLists } from "@/components/week-lists";
import { DraftKeeper } from "@/components/draft-keeper";
import { weekOf } from "@/lib/engine/intentions";

type Sp = { weekError?: string; weekSaved?: string; weekReviewed?: string };

/** The 3-1-3 form, empty to set the week or filled to edit it. The third key result and the third task may stay blank. */
export type Share = { text: string; link: string | null; reason: string | null; shared: boolean };
export type Back = "/today" | "/intentions";
function WeekForm({ week, back, owner, today }: { week: WeeklyIntention | null; back: Back; owner: string | null; today: string }) {
  const kr = (i: number) => week?.keyResults[i]?.text ?? "";
  const task = (i: number) => week?.tasks[i]?.title ?? "";
  return (
    <form action={saveIntentionAction} className="space-y-3" data-testid="week-form">
      <input type="hidden" name="back" value={back} />
      {/* Keyed by the week the answers are for (rev 444): a refusal or a slip never costs the 3-1-3. */}
      {owner ? <DraftKeeper id={`week.${owner}.${week?.weekOf ?? weekOf(today)}`} /> : null}
      <label className="block text-sm font-medium">
        ONE word (or a short phrase) to embody this week
        <input className="field mt-1" name="word" defaultValue={week?.word ?? ""} placeholder="Consistent, or Show up daily" maxLength={60} data-testid="week-word" />
      </label>
      <WeekLists keyResults={[0, 1, 2].map(kr)} tasks={[0, 1, 2].map(task)}>
        <label className="block text-sm font-medium">
          ONE initiative toward your bigger goal
          <input className="field mt-1" name="initiative" defaultValue={week?.initiative ?? ""} placeholder="Finish my webinar slides" data-testid="week-initiative" />
        </label>
      </WeekLists>
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
export function WeekCard({ week, today, taskDone, sp, back = "/intentions", share = null, owner = null }: { week: WeeklyIntention | null; today: string; taskDone: Record<string, boolean>; sp: Sp; back?: Back; share?: Share | null; owner?: string | null }) {
  const state = intentionPrompt(today, week);
  const notes = (
    <>
      {sp.weekError ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="week-error">{sp.weekError}</p> : null}
      {sp.weekSaved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="week-saved">Saved. Your tasks are on your list, due Friday.</p> : null}
      {sp.weekReviewed ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="week-reviewed">Marked. See you Monday.</p> : null}
    </>
  );
  if (state === "set" || !week) {
    return (
      <section id="week" className="mb-5" data-testid="week-card" data-state="set">
        <Card title="Set your week" action={<Badge tone="accent">3-1-3</Badge>}>
          {notes}
          <p className="mb-3 text-sm text-ink-2">Choose ONE word (or a short phrase) to embody this week, then THREE key results you can track, ONE initiative toward your bigger goal, and THREE tasks that move the needle.</p>
          <WeekForm week={null} back={back} owner={owner} today={today} />
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
                  {krProgress(k.text, k.actual)}
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
        {share ? (
          <div className="mt-4 rounded-lg border p-3" data-testid="week-share">
            <p className="mb-2 text-sm font-medium">Post your 3-1-3 in this week&apos;s community thread: one tap copies it and opens the post.</p>
            <ShareButton {...share} />
          </div>
        ) : null}
        {state === "review" ? (
          <form action={reviewIntentionAction} className="mt-4 rounded-lg border p-3" data-testid="week-review">
            <input type="hidden" name="back" value={back} />
            <p className="mb-2 text-sm font-medium">The week is nearly done. How many did you get?</p>
            <ul className="space-y-2 text-sm">
              {week.keyResults.map((k, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">{k.text}</span>
                  {targetOf(k.text) !== null ? (
                    <label className="flex items-center gap-2">
                      <input className="field w-20" name={`kr${i + 1}Count`} inputMode="numeric" defaultValue={k.actual ?? ""} placeholder="0" aria-label={`How many: ${k.text}`} data-testid={`week-review-kr${i + 1}-count`} />
                      <span className="text-ink-3">of {targetOf(k.text)}</span>
                    </label>
                  ) : (
                    <>
                      <label className="flex items-center gap-1">
                        <input type="radio" name={`kr${i + 1}`} value="done" data-testid={`week-review-kr${i + 1}-done`} /> Done
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" name={`kr${i + 1}`} value="not" data-testid={`week-review-kr${i + 1}-not`} /> Not done
                      </label>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <SubmitButton className="btn btn-primary btn-sm mt-3" pendingText="Saving…" data-testid="week-review-save">
              Mark my week
            </SubmitButton>
          </form>
        ) : null}
        <details className="mt-4">
          <summary className="inline-flex cursor-pointer" data-testid="week-edit"><span className="btn btn-soft btn-xs">Edit this week</span></summary>
          <div className="mt-3">
            <WeekForm week={week} back={back} owner={owner} today={today} />
          </div>
        </details>
      </Card>
    </section>
  );
}
