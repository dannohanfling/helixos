import type { MonthlyFeedback } from "@/db/schema";
import { saveFeedbackAction } from "@/lib/actions/feedback";
import { monthLabel } from "@/lib/engine/feedback";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";

type Sp = { feedbackError?: string; feedbackSaved?: string };

function FeedbackForm({ month, given }: { month: string; given: MonthlyFeedback | null }) {
  const area = (name: string, label: string, value: string | null | undefined, rows = 2) => (
    <label className="block text-sm font-medium">
      {label}
      <textarea className="field mt-1" name={name} rows={rows} defaultValue={value ?? ""} data-testid={`feedback-${name}`} />
    </label>
  );
  return (
    <form action={saveFeedbackAction} className="space-y-3" data-testid="feedback-form">
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
 * End-of-month feedback on Today (handoff rev 124), from the last 3 days of a month through the 5th of the next, about the month
 * ending. Once sent it folds to a thank-you that can be opened to change it while the window is open.
 */
export function FeedbackCard({ month, given, sp }: { month: string; given: MonthlyFeedback | null; sp: Sp }) {
  return (
    <section id="feedback" className="mb-5" data-testid="feedback-card" data-state={given ? "given" : "ask"}>
      <Card title={`Your feedback on ${monthLabel(month)}`} action={<Badge tone={given ? "good" : "accent"}>{given ? "Sent" : "5 to 10 minutes"}</Badge>}>
        {sp.feedbackError ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="feedback-error">{sp.feedbackError}</p> : null}
        {sp.feedbackSaved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="feedback-saved">Thank you. It helps us make next month better.</p> : null}
        {given ? (
          <details>
            <summary className="cursor-pointer text-sm text-ink-2" data-testid="feedback-edit">Thanks for your feedback. Change it until the 5th.</summary>
            <div className="mt-3">
              <FeedbackForm month={month} given={given} />
            </div>
          </details>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-2">A few questions about the month. It takes 5 to 10 minutes, and it shapes what we do next.</p>
            <FeedbackForm month={month} given={null} />
          </>
        )}
      </Card>
    </section>
  );
}
