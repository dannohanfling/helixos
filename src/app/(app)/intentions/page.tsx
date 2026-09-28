import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { keyResultTally, krProgress, weekOf } from "@/lib/engine/intentions";
import { monthOf } from "@/lib/engine/month-intentions";
import { feedbackMonth, monthLabel } from "@/lib/engine/feedback";
import { FeedbackCard } from "@/components/feedback-card";
import { MONTH_ASK_DAYS } from "@/lib/engine/intentions";
import { formatDate } from "@/lib/dates";
import { WeekCard } from "@/components/week-card";
import { shareFor } from "@/lib/community";
import { MonthAnswers, MonthCard } from "@/components/month-card";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Intentions" };

type Sp = { weekError?: string; weekSaved?: string; weekReviewed?: string; monthError?: string; monthSaved?: string; feedbackError?: string; feedbackSaved?: string };

/**
 * Intentions (handoff rev 130): the week and the month together. This week's 3-1-3 (the form, the set week with Edit, or the
 * end-of-week check from Friday to Sunday), this month's intention (the form, or the answers with Edit), then every past week and
 * month, newest first, each in a fold. Today keeps the prompts and a one-line summary.
 */
export default async function IntentionsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const ws = v.workspace.id;
  const thisWeek = weekOf(v.today);
  const thisMonth = monthOf(v.today);
  const [week, month, pastWeeks, pastMonths] = await Promise.all([
    db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, ws), eq(schema.weeklyIntentions.userId, v.user.id), eq(schema.weeklyIntentions.weekOf, thisWeek)) }),
    db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.workspaceId, ws), eq(schema.monthlyIntentions.userId, v.user.id), eq(schema.monthlyIntentions.month, thisMonth)) }),
    db.query.weeklyIntentions.findMany({ where: and(eq(schema.weeklyIntentions.workspaceId, ws), eq(schema.weeklyIntentions.userId, v.user.id), lt(schema.weeklyIntentions.weekOf, thisWeek)), orderBy: [desc(schema.weeklyIntentions.weekOf)], limit: 52 }),
    db.query.monthlyIntentions.findMany({ where: and(eq(schema.monthlyIntentions.workspaceId, ws), eq(schema.monthlyIntentions.userId, v.user.id), lt(schema.monthlyIntentions.month, thisMonth)), orderBy: [desc(schema.monthlyIntentions.month)], limit: 24 }),
  ]);
  const taskIds = (week?.tasks ?? []).map((t) => t.taskId).filter((x): x is string => Boolean(x));
  const tasks = taskIds.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, v.user.id), inArray(schema.tasks.id, taskIds)) }) : [];
  const taskDone = Object.fromEntries(tasks.map((t) => [t.id, t.status === "done"]));
  const share = week ? await shareFor(ws, v.user.id, week) : null;
  // End-of-month feedback (rev 157: here, not on Today): only in its window, about the month ending. What they wrote for that
  // month's question 11 is shown back to them, and only them, to compare (rev 129).
  const fbMonth = feedbackMonth(v.today);
  const [fbGiven, fbLook] = fbMonth
    ? await Promise.all([
        db.query.monthlyFeedback.findFirst({ where: and(eq(schema.monthlyFeedback.workspaceId, ws), eq(schema.monthlyFeedback.userId, v.user.id), eq(schema.monthlyFeedback.month, fbMonth)) }),
        db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.workspaceId, ws), eq(schema.monthlyIntentions.userId, v.user.id), eq(schema.monthlyIntentions.month, fbMonth)) }),
      ])
    : [undefined, undefined];
  const monthOptional = !month && Number(v.today.slice(8, 10)) > MONTH_ASK_DAYS;

  return (
    <>
      <PageHeader title="Intentions" subtitle="Your week and your month, set on purpose." />
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">This week</h2>
      <WeekCard week={week ?? null} today={v.today} taskDone={taskDone} sp={sp} back="/intentions" share={share} />
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">This month</h2>
      <MonthCard m={month ?? null} month={thisMonth} sp={sp} back="/intentions" optional={monthOptional} owner={v.user.id} />
      {fbMonth ? (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">End-of-month feedback</h2>
          <FeedbackCard month={fbMonth} given={fbGiven ?? null} lookBack={fbLook?.proudEnd ?? null} sp={sp} owner={v.user.id} />
        </>
      ) : null}
      <Card title="History" action={<span className="text-xs text-ink-3">{pastWeeks.length} weeks · {pastMonths.length} months</span>}>
        {pastWeeks.length || pastMonths.length ? (
          <div className="grid gap-4 md:grid-cols-2" data-testid="intentions-history">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Past weeks</div>
              <ul className="space-y-1">
                {pastWeeks.map((w) => (
                  <li key={w.id} data-testid="history-week">
                    <details className="rounded-lg border p-2 text-sm">
                      <summary className="cursor-pointer">
                        Week of {formatDate(w.weekOf)} · <b>{w.word}</b>
                        <span className="ml-2 text-xs text-ink-3">{w.reviewedAt ? keyResultTally(w.keyResults.map((k) => k.done)) : "not marked"}</span>
                      </summary>
                      <div className="mt-2 space-y-1 text-ink-2">
                        <ul>
                          {w.keyResults.map((k, i) => (
                            <li key={i}>
                              {k.done === true ? "✓" : k.done === false ? "✗" : "·"} {krProgress(k.text, k.actual)}
                            </li>
                          ))}
                        </ul>
                        <p>Initiative: {w.initiative}</p>
                        <p>Tasks: {w.tasks.map((t) => t.title).join("; ")}</p>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Past months</div>
              <ul className="space-y-1">
                {pastMonths.map((m) => (
                  <li key={m.id} data-testid="history-month">
                    <details className="rounded-lg border p-2 text-sm">
                      <summary className="cursor-pointer">
                        {monthLabel(m.month)} · <b>{m.word}</b>
                      </summary>
                      <div className="mt-2">
                        <MonthAnswers m={m} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Your past weeks and months will show here.</p>
        )}
      </Card>
    </>
  );
}
