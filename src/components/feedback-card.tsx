import type { MonthlyFeedback } from "@/db/schema";
import { saveFeedbackAction } from "@/lib/actions/feedback";
import { monthLabel } from "@/lib/engine/feedback";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";
import { DraftKeeper } from "@/components/draft-keeper";

type Sp = { feedbackError?: string; feedbackSaved?: string; feedbackMonth?: string };

function FeedbackForm({ month, given, lookBack, owner }: { month: string; given: MonthlyFeedback | null; lookBack: string | null; owner?: string }) {
  const area = (name: string, label: string, value: string | null | undefined, rows = 2) => (
    <label className="block text-sm font-medium">
      {label}
      <textarea className="field mt-1" name={name} rows={rows} defaultValue={value ?? ""} data-testid={`feedback-${name}`} />
    </label>
  );
  return (
    <form action={saveFeedbackAction} className="space-y-3" data-testid="feedback-form">
      <input type="hidden" name="month" value={month} />
      {owner ? <DraftKeeper id={`feedback.${owner}.${month}`} /> : null}
      <p className="text-xs text-ink-3" data-testid="feedback-who-reads">Your coach reads every answer here, in full. It goes to them and nowhere else.</p>
      {lookBack ? (
        <p className="rounded-lg bg-surface-2 p-2 text-sm text-ink-2" data-testid="feedback-lookback">
          At the start of {monthLabel(month).split(" ")[0]} you wrote that you wanted to look back and feel most proud of: <span className="whitespace-pre-line italic">&ldquo;{lookBack}&rdquo;</span>
        </p>
      ) : null}
      {area("proud", `What are you most proud of from ${monthLabel(month).split(" ")[0]}?`, given?.proud, 3)}
      {area("love", "Love: what did you love most?", given?.love)}
      {area("less", "Less: what should we do less of?", given?.less)}
      {area("more", "More: what should we do more of?", given?.more)}
      {area("wow", "Wow: what would wow you?", given?.wow)}
      <fieldset className="text-sm">
        <legend className="font-medium">How likely are you to refer someone to us? (1 to 10)</legend>
        <div className="mt-1 flex flex-wrap gap-2" data-testid="feedback-score">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input type="radio" name="referralScore" value={n} defaultChecked={given?.referralScore === n} data-testid={`feedback-score-${n}`} />
              {n}
            </label>
          ))}
        </div>
      </fieldset>
      {area("referral", "Who do you know who'd benefit? (optional)", given?.referral)}
      {area("favorite", "Your favorite part of the experience so far", given?.favorite)}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="feedback-save">
        {given ? "Save changes" : "Send my feedback"}
      </SubmitButton>
    </form>
  );
}

/**
 * End-of-month feedback on Intentions (handoff rev 124; all month since 9 Oct, Danno). One response per member per month, which
 * can be changed until the month ends (last month's through the 7th). Once sent it folds to "Saved" with an Edit button, never a
 * blank form. `closes` says until when, in plain words.
 */
export function FeedbackCard({ month, given, lookBack = null, sp, owner, closes, first = true }: { month: string; given: MonthlyFeedback | null; lookBack?: string | null; sp: Sp; owner?: string; closes: string; first?: boolean }) {
  // A refusal names its month; one that names none (a closed month) shows on the first card.
  const error = sp.feedbackError && (sp.feedbackMonth ? sp.feedbackMonth === month : first) ? sp.feedbackError : null;
  return (
    <section id={`feedback-${month}`} className="mb-5 scroll-mt-4" data-testid="feedback-card" data-month={month} data-state={given ? "given" : "ask"}>
      <Card title={`Your feedback on ${monthLabel(month)}`} action={<Badge tone={given ? "good" : "accent"}>{given ? "Saved" : "5 to 10 minutes"}</Badge>}>
        {error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="feedback-error">{error}</p> : null}
        {sp.feedbackSaved === month ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="feedback-saved">Thank you. It helps us make next month better.</p> : null}
        {given ? (
          <details>
            <summary data-testid="feedback-edit" className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
              <span data-testid="feedback-saved-line">Saved · your coach reads every answer</span>
              <span className="btn btn-soft btn-sm min-h-[44px]">Edit</span>
            </summary>
            <div className="mt-3">
              <p className="mb-2 text-xs text-ink-3">You can change it {closes}.</p>
              <FeedbackForm month={month} given={given} lookBack={lookBack} owner={owner} />
            </div>
          </details>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-2">A few questions about the month. It takes 5 to 10 minutes, it shapes what we do next, and you can change it {closes}.</p>
            <FeedbackForm month={month} given={null} lookBack={lookBack} owner={owner} />
          </>
        )}
      </Card>
    </section>
  );
}
