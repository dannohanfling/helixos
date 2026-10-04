import type { MonthlyIntention } from "@/db/schema";
import { saveMonthIntentionAction } from "@/lib/actions/intentions";
import { BUSINESS_SEASONS, MONTH_QUESTIONS, PERSONAL_SEASONS, revenueLabel, seasonLabel } from "@/lib/engine/month-intentions";
import { monthLabel } from "@/lib/engine/feedback";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";
import type { Back, Share } from "@/components/week-card";
import { ShareButton } from "@/components/share-button";
import { DraftKeeper } from "@/components/draft-keeper";
import { MoneyInput } from "@/components/money-input";

type Sp = { monthError?: string; monthSaved?: string };
const Q = Object.fromEntries(MONTH_QUESTIONS.map((q, i) => [q.key, `${i + 1}. ${q.q}`])) as Record<(typeof MONTH_QUESTIONS)[number]["key"], string>;

/** The eleven questions, in Danno's order, empty to set the month or filled to edit it. All eleven are required. */
function MonthForm({ m, month, back, owner }: { m: MonthlyIntention | null; month: string; back: Back; owner?: string }) {
  const area = (name: keyof MonthlyIntention, label: string, rows = 2) => (
    <label className="block text-sm font-medium">
      {label}
      <textarea className="field mt-1" name={name} rows={rows} defaultValue={(m?.[name] as string | undefined) ?? ""} data-testid={`month-${name}`} />
    </label>
  );
  const seasons = (name: "personalSeason" | "businessSeason", label: string, options: readonly string[]) => (
    <fieldset className="text-sm">
      <legend className="font-medium">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1">
            <input type="radio" name={name} value={o} defaultChecked={m?.[name] === o} data-testid={`month-${name}-${o}`} /> {seasonLabel(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <form action={saveMonthIntentionAction} className="space-y-3" data-testid="month-form">
      <input type="hidden" name="back" value={back} />
      {/* Keyed by the month the answers are for, set or not: one month's draft never lands in the next month's form. */}
      {owner ? <DraftKeeper id={`month.${owner}.${m?.month ?? month}`} legacyId={m ? undefined : `month.${owner}.new`} /> : null}
      <label className="block text-sm font-medium">
        {Q.word}
        <input className="field mt-1" name="word" defaultValue={m?.word ?? ""} placeholder="Grounded, or Show up daily" maxLength={60} data-testid="month-word" />
      </label>
      {seasons("personalSeason", Q.personalSeason, PERSONAL_SEASONS)}
      {area("fear", Q.fear)}
      {area("habit", Q.habit)}
      {area("skill", Q.skill)}
      {area("impact", Q.impact)}
      {seasons("businessSeason", Q.businessSeason, BUSINESS_SEASONS)}
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">{Q.revenue}</legend>
        <div>
          <MoneyInput name="revenueGoal" defaultValue={m ? m.revenueGoal : ""} placeholder="10000, or 10k" data-testid="month-revenueGoal" />
        </div>
        <textarea className="field" name="revenueWhy" rows={2} defaultValue={m?.revenueWhy ?? ""} placeholder="Why this number" data-testid="month-revenueWhy" />
      </fieldset>
      {area("plan", Q.plan, 3)}
      {area("proudLast", Q.proudLast)}
      {area("proudEnd", Q.proudEnd)}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="month-save">
        {m ? "Save changes" : "Set my month"}
      </SubmitButton>
    </form>
  );
}

/** A set month's answers, question by question: on the Intentions page, and folded in its history. */
export function MonthAnswers({ m }: { m: MonthlyIntention }) {
  const rows: [string, string][] = [
    [Q.word, m.word],
    [Q.personalSeason, seasonLabel(m.personalSeason)],
    [Q.fear, m.fear],
    [Q.habit, m.habit],
    [Q.skill, m.skill],
    [Q.impact, m.impact],
    [Q.businessSeason, seasonLabel(m.businessSeason)],
    [Q.revenue, `${revenueLabel(m.revenueGoal)}. ${m.revenueWhy}`],
    [Q.plan, m.plan],
    [Q.proudLast, m.proudLast],
    [Q.proudEnd, m.proudEnd],
  ];
  return (
    <dl className="space-y-2 text-sm" data-testid="month-answers">
      {rows.map(([q, a]) => (
        <div key={q}>
          <dt className="text-xs text-ink-3">{q}</dt>
          <dd className="whitespace-pre-line">{a}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The monthly intention (handoff rev 129/130): "Set your month" with the eleven questions until it is set, then the answers with
 * an Edit. On Today only the setting form shows; once set, the full card lives on the Intentions page.
 */
export function MonthCard({ m, month, sp, back = "/intentions", optional = false, owner, share = null }: { m: MonthlyIntention | null; month: string; sp: Sp; back?: Back; optional?: boolean; owner?: string; share?: Share | null }) {
  const notes = (
    <>
      {sp.monthError ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="month-error">{sp.monthError}</p> : null}
      {sp.monthSaved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="month-saved">Saved. Here&apos;s to a good month.</p> : null}
    </>
  );
  if (!m) {
    return (
      <section id="month" className="mb-5" data-testid="month-card" data-state="set">
        <Card title="Set your month" action={<Badge tone="accent">{monthLabel(month)}</Badge>}>
          {notes}
          <p className="mb-3 text-sm text-ink-2">Eleven questions to start the month on purpose. Take your time with them.</p>
          {optional ? <p className="mb-3 text-xs text-ink-3" data-testid="month-optional">The month is asked for in its first week. It&apos;s optional now, and still worth doing.</p> : null}
          <MonthForm m={null} month={month} back={back} owner={owner} />
        </Card>
      </section>
    );
  }
  return (
    <section id="month" className="mb-5" data-testid="month-card" data-state="shown">
      <Card title={`Your month: ${monthLabel(month)}`} action={<Badge tone="accent">{m.word}</Badge>}>
        {notes}
        <div className="text-2xl font-bold tracking-tight" data-testid="month-word-shown">{m.word}</div>
        <div className="mt-3">
          <MonthAnswers m={m} />
        </div>
        {/* Share to this month's thread (1 Oct): the same tap as the week's, with the eleven answers. */}
        {share ? (
          <div className="mt-4 rounded-lg border p-3" data-testid="month-share">
            <p className="mb-2 text-sm font-medium">Post your month in this month&apos;s community thread: one tap copies your eleven answers and opens the post.</p>
            <ShareButton {...share} scope="month" />
          </div>
        ) : null}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-3" data-testid="month-edit">Edit this month</summary>
          <div className="mt-3">
            <MonthForm m={m} month={month} back={back} owner={owner} />
          </div>
        </details>
      </Card>
    </section>
  );
}
