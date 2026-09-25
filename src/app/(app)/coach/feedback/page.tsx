import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { monthLabel, monthSummary, prevMonth, trendLine } from "@/lib/engine/feedback";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Monthly feedback" };

/**
 * The coach's end-of-month feedback (handoff rev 124): responses per month, the average referral score and its trend against the
 * month before, the "proud of" answers listed together, and each response in full. A proud-of answer is the member's own words,
 * not a client result: nothing here sends it to Proof Bank or the bot.
 */
export default async function CoachFeedbackPage() {
  const v = await requireCoach();
  const rows = await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, v.workspace.id), orderBy: [desc(schema.monthlyFeedback.month), desc(schema.monthlyFeedback.createdAt)] });
  const users = rows.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(rows.map((r) => r.userId))]) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const months = [...new Set(rows.map((r) => r.month))];
  const summaryOf = (m: string) => monthSummary(rows.filter((r) => r.month === m).map((r) => r.referralScore));

  return (
    <>
      <PageHeader title="Monthly feedback" subtitle={`${rows.length} responses across ${months.length} month${months.length === 1 ? "" : "s"}`} action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      <p className="mb-4 text-xs text-ink-3">A &ldquo;proud of&rdquo; answer is a member&apos;s own words, not a client result. It never goes to Proof Bank or your bot without the member&apos;s permission.</p>
      {months.length ? null : <p className="text-sm text-ink-2">No feedback yet. Members see the card on Today from the last 3 days of a month through the 5th of the next.</p>}
      <div className="space-y-4">
        {months.map((m) => {
          const s = summaryOf(m);
          const trend = trendLine(s.average, summaryOf(prevMonth(m)).average);
          const these = rows.filter((r) => r.month === m);
          return (
            <Card key={m} title={monthLabel(m)} action={<Badge tone="neutral">{s.count} response{s.count === 1 ? "" : "s"}</Badge>}>
              <div data-testid="feedback-month" data-month={m}>
                <p className="text-sm" data-testid="feedback-average">
                  Average referral score: <b>{s.average?.toFixed(1)}</b> of 10
                  {trend ? <span className="text-ink-3"> · {trend} from {monthLabel(prevMonth(m)).split(" ")[0]}</span> : null}
                </p>
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">What they&apos;re proud of</div>
                  <ul className="mt-1 space-y-1 text-sm" data-testid="feedback-proud">
                    {these.map((r) => (
                      <li key={r.id}>
                        <span className="font-medium">{nameOf.get(r.userId) ?? "A member"}:</span> <span className="whitespace-pre-line text-ink-2">{r.proud}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-ink-3" data-testid="feedback-all">Every response in full</summary>
                  <ul className="mt-2 divide-y text-sm">
                    {these.map((r) => (
                      <li key={r.id} className="py-2" data-testid="feedback-response">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{nameOf.get(r.userId) ?? "A member"}</span>
                          <Badge tone={r.referralScore >= 9 ? "good" : r.referralScore >= 7 ? "neutral" : "warn"}>{r.referralScore} / 10</Badge>
                        </div>
                        <dl className="mt-1 grid gap-1 text-ink-2 sm:grid-cols-2">
                          {(
                            [
                              ["Love", r.love],
                              ["Less", r.less],
                              ["More", r.more],
                              ["Wow", r.wow],
                              ["Would refer", r.referral],
                              ["Favorite part", r.favorite],
                            ] as const
                          )
                            .filter(([, t]) => t)
                            .map(([k, t]) => (
                              <div key={k}>
                                <dt className="inline font-medium text-ink">{k}: </dt>
                                <dd className="inline whitespace-pre-line">{t}</dd>
                              </div>
                            ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
