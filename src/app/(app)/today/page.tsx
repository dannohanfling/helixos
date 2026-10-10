import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { eveningCloseAction, morningCheckinAction, repairStreakAction } from "@/lib/actions/daily";
import type { TodayActivity } from "@/lib/queries/daily";
import type { DailyLog } from "@/db/schema";
import { completeCurriculumDayAction } from "@/lib/actions/pathway";
import { setContentStatusAction } from "@/lib/actions/content";
import { todayData } from "@/lib/queries/today";
import { TeamHome } from "@/components/team-home";
import { NewTaskForm } from "@/components/new-task-form";
import { SubmitButton } from "@/components/submit-button";
import { FailedBanner } from "@/components/channel-outcome";
import curriculumLinks from "@/data/curriculum-links.json";
import { PendingLink } from "@/components/pending-link";
import { FIELD_TASKS } from "@/lib/engine/pathway";
import { TaskRow } from "@/components/task-row";
import { Badge, Card, Empty, Field, Progress } from "@/components/ui";
import { addDays, formatDate, relativeDay } from "@/lib/dates";
import { streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { TIER_ICONS } from "@/lib/engine/tiers";
import { shareFor } from "@/lib/community";
import { COACH_ITEMS_DAYS, coachItems, newRecordings, openItemsFor } from "@/lib/recordings";
import { programLine } from "@/lib/engine/recordings";
import { ShareButton } from "@/components/share-button";
import { Top3Picker } from "@/components/top3-picker";
import { DraftKeeper } from "@/components/draft-keeper";
import { MoneyInput } from "@/components/money-input";
import { closedDates } from "@/lib/queries/daily";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { intentionPrompt, weekOf } from "@/lib/engine/intentions";
import { monthOf } from "@/lib/engine/month-intentions";
import { dayReadFor, todayBody, workoutReadFor } from "@/lib/queries/body";
import { WorkoutReadCard } from "@/components/body/workout-read";
import { logHabitAction, takeMedAction } from "@/lib/actions/body";
import { CLOSE_MONEY, ENERGY_WORDS } from "@/lib/daily-core";
import { newMonthlyFeedback, unseenReports } from "@/lib/queries/reports";
import { openClaims } from "@/lib/queries/rewards";
import { recentlyOn, waitingFeatures } from "@/lib/bot-features";
import { goalsNow } from "@/lib/body-goals";
import { PACE_LABEL } from "@/lib/engine/kpi";
import { STATE_WORDS } from "@/lib/engine/body-goals";

export const metadata = { title: "Today" };

/** Where a 30-day build day is actually done: a feature in the app, or a lesson link Danno sets in src/data/curriculum-links.json. */
const exerciseLink = (day: number): string | null => {
  const url = ((curriculumLinks as Record<string, string>)[String(day)] ?? "").trim();
  return url || null;
};

/** Before this hour (the member's own clock) the close form is folded away so the morning scroll reaches the day's work. */
const EVENING_HOUR = 16;

function greeting(hour: number, name: string): string {
  const first = name.split(" ")[0];
  if (hour < 5) return `Still up, ${first}?`;
  if (hour < 12) return `Morning, ${first}.`;
  if (hour < 17) return `Afternoon, ${first}.`;
  return `Evening, ${first}.`;
}

const ENERGY = ["", ...ENERGY_WORDS];

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ weekError?: string; weekSaved?: string; weekReviewed?: string; monthError?: string; monthSaved?: string; feedbackError?: string; feedbackSaved?: string; closeError?: string; field?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  // A team member (Danno, 6 Oct) sees the doors open to them, not the owner's day.
  if (v.team) return <TeamHome v={v} />;
  const sp = await searchParams;
  const d = await todayData(v);
  // The weekly 3-1-3 (rev 124): this week's, and whether each of its tasks is done yet.
  const week = (await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, v.workspace.id), eq(schema.weeklyIntentions.userId, v.user.id), eq(schema.weeklyIntentions.weekOf, weekOf(v.today))) })) ?? null;
  const share = week ? await shareFor(v.workspace.id, v.user.id, week) : null;
  // The monthly intention (rev 129): this month's, if set.
  const month = (await db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.workspaceId, v.workspace.id), eq(schema.monthlyIntentions.userId, v.user.id), eq(schema.monthlyIntentions.month, monthOf(v.today))) })) ?? null;
  const weekState = intentionPrompt(v.today, week);
  const closed = await closedDates(v.workspace.id, v.user.id);
  // Body's one line (rev 179): the member's own, only once they've set Body up. It counts toward nothing on this page.
  const body = await todayBody(v);
  // Goals (rev 508 §5): the two that need it most, under the HumanOS line.
  const goals = body ? await goalsNow({ workspaceId: v.workspace.id, userId: v.user.id }, v.today) : [];
  // HumanOS's post-workout read (rev 471): once today's session is finished, its lines sit with the day.
  const workout = body ? await workoutReadFor(v.workspace.id, v.user.id, v.today) : null;
  const streakDayIfClosedNow = d.log?.eveningDoneAt ? d.log.streakDay : weeklyStreakDay(closed, v.today);
  const bonusIfClosedNow = streakBonus(streakDayIfClosedNow);
  const morningDone = Boolean(d.log?.morningDoneAt);
  const eveningDone = Boolean(d.log?.eveningDoneAt);
  // HumanOS's end-of-day read (rev 471): in Close the day from the evening on, beside the business numbers. Private to the member.
  const bodyDayRead = body && (eveningDone || v.hour >= EVENING_HOUR) ? await dayReadFor(v.workspace.id, v.user.id, v.today, v.today, v.hour, v.tz) : null;
  const openFocus = d.focusTasks.filter((t) => t.status !== "done");
  const doneFocus = d.focusTasks.filter((t) => t.status === "done");
  const boardTasks = [...d.overdueTasks, ...d.dueTasks].filter((t) => t.focusDate !== v.today);
  const goalPct = d.goal ? Math.round((d.goal.actual / Math.max(d.goal.target, 1)) * 100) : 0;
  const primary = d.actions[0];
  const rest = d.actions.slice(1, 6);
  // Before lock-in the hero is the lock-in itself, so Then lists everything else, the lock-in left out.
  const thenList = morningDone ? rest : d.actions.filter((a) => a.key !== "checkin").slice(0, 5);
  // Rev 497: the recordings' action items in Then. A member gets a line per call (the two newest) with items still for them to
  // decide, and a line for calls not yet opened (rev 498); the coach one line for the items from the last two weeks' calls.
  const seer = { userId: v.user.id, programTier: v.membership.programTier, role: v.role };
  const recLines: { key: string; title: string; href: string }[] = [];
  if (v.role === "client") {
    const [open, fresh] = await Promise.all([openItemsFor(v.workspace.id, { ...seer, email: v.user.email }), newRecordings(v.workspace.id, seer)]);
    const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: v.tz, weekday: "short" }).format(new Date(iso)) : "a recent");
    const callName = (a: string | null) => (a === "members" || !a ? "one-to-one" : `${programLine(a as "academy")} call`);
    for (const o of open.slice(0, 2)) recLines.push({ key: `rec-${o.recording.id}`, title: `From ${day(o.recording.startedAt)}'s ${callName(o.recording.audience)}: ${o.count} action item${o.count === 1 ? "" : "s"} for you`, href: `/recordings/${o.recording.id}#steps` });
    if (open.length > 2) recLines.push({ key: "rec-more", title: `+${open.length - 2} more call${open.length - 2 === 1 ? "" : "s"} with action items`, href: "/recordings" });
    if (fresh.length) recLines.push({ key: "rec-new", title: `${fresh.length} new recording${fresh.length === 1 ? "" : "s"} to watch`, href: "/recordings" });
  } else if (!v.switchedInto) {
    const items = await coachItems(v.workspace.id, addDays(v.today, -COACH_ITEMS_DAYS));
    const n = items.reduce((a, x) => a + x.open.length, 0);
    if (n) recLines.push({ key: "rec-coach", title: `Action items from your calls: ${n}`, href: "/coach/recordings?tab=items" });
  }

  // The coach's notice (rev 432 item 4): new monthly feedback and issues not yet opened, so neither can be missed.
  // Bot Features switched on for this member in the last seven days (rev 618): one line each, to the feature.
  const featuresOn = await recentlyOn(v.workspace.id, v.user.id);
  const coachNew = v.role === "coach" && !v.switchedInto ? await Promise.all([newMonthlyFeedback(v.workspace.id, v.membership.feedbackSeenAt), unseenReports(v.workspace.id), openClaims(v.workspace.id), waitingFeatures(v.workspace.id)]) : null;
  return (
    <>
      {coachNew && (coachNew[0] || coachNew[1] || coachNew[2] || coachNew[3]) ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="coach-new">
          {coachNew[0] ? (
            <Link href="/coach/feedback" className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink hover:underline" data-testid="coach-new-feedback">
              {coachNew[0]} new monthly feedback →
            </Link>
          ) : null}
          {coachNew[1] ? (
            <Link href="/coach/reports" className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink hover:underline" data-testid="coach-new-reports">
              {coachNew[1]} new issue{coachNew[1] === 1 ? "" : "s"} and idea{coachNew[1] === 1 ? "" : "s"} →
            </Link>
          ) : null}
          {coachNew[2] ? (
            <Link href="/coach?claims=open#claims" className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink hover:underline" data-testid="coach-new-claims">
              {coachNew[2]} reward claim{coachNew[2] === 1 ? "" : "s"} to deliver →
            </Link>
          ) : null}
          {coachNew[3] ? (
            <Link href="/coach#bot-features" className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink hover:underline" data-testid="coach-new-features">
              {coachNew[3]} bot feature{coachNew[3] === 1 ? "" : "s"} to switch on →
            </Link>
          ) : null}
        </div>
      ) : null}
      {featuresOn.length ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="features-on">
          {featuresOn.map((f) => (
            <Link key={f.key} href={`/bot-features/${f.key}`} className="rounded-lg bg-good-soft px-3 py-2 text-sm font-medium hover:underline" data-testid="feature-on-line">
              {f.name} is on · running in your bot →
            </Link>
          ))}
        </div>
      ) : null}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-ink-2">{formatDate(v.today, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting(v.hour, v.user.name)}</h1>
          <Link href="/pathway" className="mt-1 inline-block text-xs text-ink-2 hover:underline" data-testid="road">
            🛣️ {d.road}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${d.streak > 0 ? "badge-accent" : ""}`} title="Weekday streak">
            🔥 {d.streak}-day streak
          </span>
          <span className="badge">
            {TIER_ICONS[d.tier.current.name]} {d.tier.current.name} · {d.points.toLocaleString()} pts
          </span>
        </div>
      </div>

      {/* The week, the month and the feedback live on Intentions (rev 157): Today keeps one line once they're set, and the menu's badge says when something is due. */}
      {month || week ? (
        <section className="card mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm" data-testid="intentions-summary">
          {month ? (
            <span>
              This month: <b data-testid="summary-month-word">{month.word}</b>
            </span>
          ) : null}
          {week ? (
            <span>
              This week: <b data-testid="summary-week-word">{week.word}</b>
            </span>
          ) : null}
          {sp.monthSaved || sp.weekSaved ? <span className="text-good" role="status" data-testid="summary-saved">Saved.</span> : null}
          {share ? <ShareButton {...share} compact /> : null}
          {weekState === "review" ? (
            <Link href="/intentions#week" className="font-medium underline" data-testid="summary-review">
              The week is nearly done: mark your key results
            </Link>
          ) : null}
          <Link href="/intentions" className="ml-auto text-xs text-ink-2 underline" data-testid="summary-link">
            Intentions →
          </Link>
        </section>
      ) : null}

      {d.firstSession ? (
        <section className="card mb-5 border-accent p-5" style={{ background: "var(--accent-soft)" }} data-testid="welcome">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Welcome to HelixOS</div>
          <div className="mt-1 text-xl font-bold">One loop, every weekday. That&apos;s the whole system.</div>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <li className="rounded-lg bg-surface p-3">
              <b>1 · Lock in</b>
              <div className="text-ink-2">60 seconds. Pick your top 3 for today.</div>
            </li>
            <li className="rounded-lg bg-surface p-3">
              <b>2 · Do the work</b>
              <div className="text-ink-2">Post, reach out, follow up. Tick things off as you go.</div>
            </li>
            <li className="rounded-lg bg-surface p-3">
              <b>3 · Close the day</b>
              <div className="text-ink-2">90 seconds. Your numbers and your win.</div>
            </li>
          </ol>
          <p className="mt-3 text-sm text-ink-2">Points, streaks and your pathway all come from that loop. Your top 3 for today are already waiting below.</p>
          <a href="#checkin" className="btn btn-primary mt-3">
            Lock in your first day
          </a>
        </section>
      ) : null}

      {d.broken ? (
        <section className="card mb-5 border-warn p-4" style={{ background: "var(--warn-soft)" }} data-testid="streak-broken">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                Your {d.broken.lost}-day streak ended {formatDate(d.broken.endedOn, { weekday: "long" })}.
              </div>
              <div className="text-sm text-ink-2">
                {d.broken.repairable && d.repairsLeft > 0
                  ? `One weekday slipped (${formatDate(d.broken.missed[0], { weekday: "long", month: "short", day: "numeric" })}). Mend it and the streak carries on; the weekly bonus still restarts at day 1. One repair a month.`
                  : d.broken.repairable
                    ? "One weekday slipped, and this month's repair is already used. Day 1 is 10 points. By Friday it's 310."
                    : `${d.broken.missed.length} weekdays slipped. The system doesn't punish pauses, it just resets. Day 1 is 10 points. By Friday it's 310.`}
              </div>
            </div>
            {d.broken.repairable && d.repairsLeft > 0 ? (
              <form action={repairStreakAction}>
                <input type="hidden" name="date" value={d.broken.missed[0]} />
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Repairing…">
                  Repair the streak
                </SubmitButton>
              </form>
            ) : (
              <a href="#close" className="btn btn-soft btn-sm">
                Start day 1 tonight
              </a>
            )}
          </div>
        </section>
      ) : null}

      {/* Before lock-in, the lock-in is the hero, at the content's full width (rev 531: squeezed into the left column it truncated
          the top 3 to eight letters, under a tall hero that only said "Start lock-in"). */}
      {!morningDone ? (
        <section id="checkin" className="card mb-5 border-accent p-5" style={{ background: "var(--accent-soft)" }} data-testid="lockin-hero">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Next best action</div>
              <h2 className="mt-1 text-xl font-bold">Lock in your day</h2>
              <p className="mt-1 text-sm text-ink-2">Pick your top 3 and set your energy. 60 seconds.</p>
            </div>
            <Badge tone="accent">+10 pts</Badge>
          </div>
          <LockInForm openTasks={d.openTasks} stillOpen={d.stillOpen} today={v.today} defaultIntention="" />
        </section>
      ) : null}

      {/* Next best action */}
      <section className={`mb-5 grid gap-3 ${morningDone ? "md:grid-cols-[1.4fr_1fr]" : ""}`}>
        {morningDone ? <div className={`card p-5 ${primary.tone === "warning" ? "border-warn" : "border-accent"}`} style={{ background: primary.tone === "warning" ? "var(--warn-soft)" : "var(--accent-soft)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Next best action</div>
          <div className="mt-1 text-xl font-bold">{primary.title}</div>
          <div className="mt-1 text-sm text-ink-2">{primary.why}</div>
          <div className="mt-3 flex items-center gap-3">
            <Link href={primary.href} className="btn btn-primary">
              {primary.cta}
            </Link>
            {primary.points ? <span className="text-sm font-semibold text-accent-ink">+{primary.points} pts</span> : null}
          </div>
        </div> : null}
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Then</div>
          <ul className="mt-2 space-y-2">
            {recLines.map((a) => (
              <li key={a.key} data-testid="then-recording">
                <Link href={a.href} className="flex items-start gap-2 text-sm hover:underline">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span>{a.title} →</span>
                </Link>
              </li>
            ))}
            {thenList.length || recLines.length ? (
              thenList.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-start gap-2 text-sm hover:underline">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === "warning" ? "bg-warn" : a.tone === "primary" ? "bg-accent" : "bg-ink-3"}`} />
                    <span>
                      {a.title}
                      {a.points ? <span className="ml-1 text-xs text-ink-3">+{a.points}</span> : null}
                    </span>
                  </Link>
                </li>
              ))
            ) : (
              <li className="text-sm text-ink-2">That&apos;s the whole list. Nice.</li>
            )}
          </ul>
          {d.goal && d.goal.target > 0 ? (
            <div className="mt-4 border-t pt-3">
              <div className="flex items-center justify-between gap-2 text-xs" data-testid="today-goal-bar" data-pace={d.goal.pace}>
                <span className="font-semibold text-ink-2">
                  {d.goal.recordId ? <Link href={`/goals/${d.goal.recordId}`} className="hover:underline" data-testid="today-goal-link">{d.goal.title}</Link> : d.goal.title}
                  {d.goal.name && d.goal.name !== d.goal.title ? <span className="ml-1 font-normal text-ink-3">· {d.goal.name}</span> : null}
                  {d.goal.pace !== "none" ? <span className="ml-1 font-normal text-ink-3">· {PACE_LABEL[d.goal.pace].toLowerCase()}</span> : null}
                </span>
                <span className="tabular text-ink-2">
                  {d.goal.unit === "$" ? "$" : ""}
                  {d.goal.actual.toLocaleString()} / {d.goal.unit === "$" ? "$" : ""}
                  {d.goal.target.toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5">
                <Progress value={goalPct} tone={goalPct >= 100 ? "good" : "accent"} height={6} />
              </div>
            </div>
          ) : (
            <div className="mt-4 border-t pt-3 text-xs text-ink-3">
              <Link href="/settings" className="underline">Set your one goal</Link> and it shows here, filled by the cash you log in the close.
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {/* After lock-in: a compact summary (energy, the win line, the 3 picks to tick, Edit), with the 30-day build under it. */}
          {morningDone ? (
            <Card id="checkin" title="Today's lock-in" action={<Badge tone="good">Done · +10</Badge>}>
              <div className="space-y-3" data-testid="lockin-summary">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="badge">⚡ {ENERGY[d.log?.energy ?? 3]}</span>
                  {d.log?.intention ? <span className="text-ink-2">“{d.log.intention}”</span> : null}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">
                    Top 3 · {doneFocus.length}/{d.focusTasks.length} done
                  </div>
                  {d.focusTasks.length ? (
                    <div className="-mx-2 divide-y">
                      {[...openFocus, ...doneFocus].map((t) => (
                        <TaskRow key={t.id} task={t} today={v.today} compact showCategory={false} origin={d.taskOrigins.get(t.id)} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-2">No top 3 picked. Star a task below to add one.</p>
                  )}
                </div>
                <details>
                  <summary className="text-xs text-ink-3 underline">Edit lock-in</summary>
                  <LockInForm openTasks={d.openTasks} stillOpen={d.stillOpen} today={v.today} defaultIntention={d.log?.intention ?? ""} />
                </details>
              </div>
            </Card>
          ) : null}
          {d.curriculumDay ? (
            <Card title={`30-day build · Day ${d.curriculumDay.day}`} action={<Badge tone="accent">+{d.curriculumDay.points}</Badge>}>
              <p className="mb-2 text-xs text-ink-3" data-testid="onramp">The on-ramp into Stage 1 of your Pathway. One day, one step.</p>
              <div className="font-semibold">{d.curriculumDay.title}</div>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{d.curriculumDay.instructions}</p>
              <div className="mt-2 text-xs text-ink-3">
                {d.curriculumDay.week} · {d.curriculumDay.estTime}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {exerciseLink(d.curriculumDay.day) ? (
                  exerciseLink(d.curriculumDay.day)!.startsWith("http") ? (
                    <a href={exerciseLink(d.curriculumDay.day)!} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" data-testid="exercise-link">
                      Open the lesson ↗
                    </a>
                  ) : (
                    <PendingLink href={exerciseLink(d.curriculumDay.day)!} className="btn btn-primary btn-sm" data-testid="exercise-link">
                      Do it in the app →
                    </PendingLink>
                  )
                ) : null}
                <form action={completeCurriculumDayAction}>
                  <input type="hidden" name="day" value={d.curriculumDay.day} />
                  <SubmitButton className="btn btn-accent btn-sm" pendingText="Logging…">
                    Done, log it
                  </SubmitButton>
                </form>
              </div>
            </Card>
          ) : null}

          {/* Today's board */}
          <Card title="Also on your plate" action={<NewTaskForm today={v.today} />}>
            {boardTasks.length ? (
              <div className="-mx-2 divide-y">
                {boardTasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={v.today} origin={d.taskOrigins.get(t.id)} />
                ))}
              </div>
            ) : (
              <Empty icon="🧹" title="Board is clear" hint="Nothing overdue, nothing else due today." />
            )}
          </Card>

          {/* Content + conversations */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Content to ship" action={<Link href="/content" className="text-xs text-ink-2 hover:underline">All content →</Link>}>
              {d.failedPosts.map((p) => (
                <FailedBanner key={p.id} outcomes={p.outcomes} contentId={p.id} title={p.title} className="mb-3 text-xs" />
              ))}
              {d.contentDue.length ? (
                <ul className="space-y-2">
                  {d.contentDue.map((c) => {
                    const day = c.postAt?.slice(0, 10) ?? v.today;
                    const late = day < v.today;
                    return (
                      <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <Link href={`/content/${c.id}`} className="font-medium hover:underline">
                            {c.title}
                          </Link>
                          <div className="text-xs text-ink-3">
                            {c.platform} · {late ? <span className="font-semibold text-danger">{relativeDay(day, v.today)}</span> : c.status}
                          </div>
                        </div>
                        <form action={setContentStatusAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value="posted" />
                          <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">
                            Mark as posted
                          </SubmitButton>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty icon="✍️" title="Nothing scheduled today" hint="One post a day keeps the algorithm warm." action={<Link href="/content" className="btn btn-ghost btn-sm">Plan a post</Link>} />
              )}
            </Card>
            <Card title="Conversations" action={<Link href="/conversations" className="text-xs text-ink-2 hover:underline">All DMs →</Link>}>
              {d.inbound.length || d.followUps.length ? (
                <ul className="space-y-2 text-sm">
                  {d.inbound.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/conversations/${c.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {c.name}
                      </Link>
                      <Badge tone="warn">replied · waiting on you</Badge>
                    </li>
                  ))}
                  {d.followUps
                    .filter((c) => !d.inbound.some((i) => i.id === c.id))
                    .map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <Link href={`/conversations/${c.id}`} className="min-w-0 truncate font-medium hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-xs text-ink-3">follow up · {c.stage.replace("_", " ")}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <Empty icon="💬" title="No follow-ups due" hint="Start 3 new conversations today." action={<Link href="/conversations?new=1" className="btn btn-ghost btn-sm">Add a contact</Link>} />
              )}
            </Card>
          </div>
        </div>

        {/* The right column: the close, HumanOS, your brand, the pathway, what's coming, the level (friction walk T4, 7 Oct:
            since the 6 Oct layout the 30-day build card's tail sat here, so the board and the close rendered inside it). */}
        <div className="space-y-4">
          {/* Evening close */}
          <Card id="close" title={eveningDone ? "Day closed" : "Close the day"} action={eveningDone ? <Badge tone="good">Done · streak day {d.log?.streakDay}</Badge> : <Badge tone="accent">+20 {bonusIfClosedNow ? `+${bonusIfClosedNow} streak` : ""}</Badge>}>
            {eveningDone && d.log ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    ["DMs", d.log.dmsStarted],
                    ["Convos", d.log.conversations],
                    ["Calls booked", d.log.callsBooked],
                    ["Calls held", d.log.callsHeld],
                    ["Posts", d.log.posts],
                    ["Cash", `$${d.log.cashCollected.toLocaleString()}`],
                  ].map(([k, val]) => (
                    <div key={String(k)} className="rounded-lg bg-surface-2 p-2 text-center">
                      <div className="text-lg font-semibold tabular">{val}</div>
                      <div className="text-[11px] text-ink-3">{k}</div>
                    </div>
                  ))}
                </div>
                {d.log.win ? (
                  <p>
                    <span className="font-semibold">Win:</span> {d.log.win}
                  </p>
                ) : null}
                <details open={Boolean(sp.closeError)}>
                  <summary className="text-xs text-ink-3 underline">Edit today&apos;s numbers</summary>
                  <CloseForm log={d.log} activity={d.activity} owner={v.switchedInto ? null : v.user.id} today={v.today} error={sp.closeError} closeKpis={d.closeKpis} />
                </details>
              </div>
            ) : v.hour < EVENING_HOUR ? (
              <details data-testid="close-early" open={Boolean(sp.closeError)}>
                <summary className="cursor-pointer text-sm text-ink-2">
                  It&apos;s not evening yet. Come back after {EVENING_HOUR - 12}pm to log your numbers, or <span className="underline">close the day early</span>.
                </summary>
                <CloseForm log={d.log} activity={d.activity} owner={v.switchedInto ? null : v.user.id} today={v.today} error={sp.closeError} closeKpis={d.closeKpis} />
              </details>
            ) : (
              <CloseForm log={d.log} activity={d.activity} owner={v.switchedInto ? null : v.user.id} today={v.today} error={sp.closeError} closeKpis={d.closeKpis} />
            )}
            {bodyDayRead ? (
              <div className="mt-4 rounded-lg bg-humanos-soft p-3 text-sm" data-testid="today-day-read">
                <p className="text-xs font-semibold text-humanos-ink">Your body today</p>
                <ul className="mt-1 space-y-0.5" data-testid="day-read-lines">
                  {bodyDayRead.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="mt-2 font-medium" data-testid="day-read-tomorrow">
                  {bodyDayRead.tomorrow}
                </p>
              </div>
            ) : null}
          </Card>
          {body ? (
            <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-testid="today-humanos">
              {body.line ? (
                <Link href="/body" className="min-w-0 flex-1 hover:underline" data-testid="today-body">
                  <span className="font-semibold">{body.dayType ?? "HumanOS"}</span>
                  <span className="tabular text-ink-2"> · {body.line}</span> →{body.reminder ? <span className="mt-1 block text-xs text-ink-3">📌 {body.reminder}</span> : null}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 font-semibold">HumanOS</span>
              )}
              <Link href="/body#log" className="btn btn-humanos btn-sm" data-testid="today-log-meal">
                Log a meal
              </Link>
              {body.habits.length ? (
                /* B7 habits (rev 196), placed by rev 201: one row of one-tap chips inside this same card, below the line. */
                <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="today-habits" data-kept={body.habits.filter((h) => h.kept).length} data-due={body.habits.length}>
                  {body.habits.map((h) =>
                    h.kind === "done" ? (
                      <form key={h.id} action={logHabitAction}>
                        <input type="hidden" name="habitId" value={h.id} />
                        <input type="hidden" name="back" value="/today" />
                        <input type="hidden" name="value" value={h.kept ? "0" : "1"} />
                        <SubmitButton className={`btn btn-xs ${h.kept ? "btn-humanos" : "btn-soft"}`} pendingText="…" aria-pressed={h.kept} data-testid="today-habit" data-name={h.name} data-kept={h.kept ? "1" : "0"}>
                          {h.kept ? "✓ " : ""}
                          {h.name}
                          {h.difficulty ? <span className="ml-1 text-[9px] opacity-70" title={h.difficulty} data-testid="today-difficulty">{"●".repeat(h.difficulty === "easy" ? 1 : h.difficulty === "medium" ? 2 : 3)}</span> : null}
                          {h.streak ? (
                            <span className={`ml-1 text-[10px] ${h.kept ? "opacity-80" : "opacity-60 grayscale"}`} title={h.kept ? undefined : "Not yet today"} data-testid="today-streak" data-kept={h.kept ? "1" : "0"}>
                              🔥{h.streak}
                            </span>
                          ) : null}
                        </SubmitButton>
                      </form>
                    ) : (
                      <Link key={h.id} href="/body/practices" className={`btn btn-xs ${h.kept ? "btn-humanos" : "btn-soft"}`} data-testid="today-habit" data-name={h.name} data-kept={h.kept ? "1" : "0"}>
                        {h.kept ? "✓ " : ""}
                        {h.name}
                        {h.difficulty ? <span className="ml-1 text-[9px] opacity-70" title={h.difficulty} data-testid="today-difficulty">{"●".repeat(h.difficulty === "easy" ? 1 : h.difficulty === "medium" ? 2 : 3)}</span> : null}
                        {h.valueText && !h.kept ? <span className="ml-1 text-[10px] opacity-80">{h.valueText}</span> : null}
                      </Link>
                    ),
                  )}
                </div>
              ) : null}
              {goals.length ? (
                <Link href="/body/goals" className="w-full space-y-1 hover:underline" data-testid="today-goals">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-3">Health goals</span>
                  {goals.map((g) => (
                    <span key={g.goal.id} className="block text-xs text-ink-2" data-testid="today-goal" data-state={g.status.state}>
                      🎯 <span className="font-medium text-ink">{g.title}</span> · {STATE_WORDS[g.status.state].toLowerCase()}
                      {g.status.projected && g.status.state !== "done" ? `, lands ${formatDate(g.status.projected, { month: "short", day: "numeric" })} at this rate` : ""}
                    </span>
                  ))}
                </Link>
              ) : null}
              {body.meds.length ? (
                /* Supplements and meds (rev 424): a Take chip per dose due today, like habits, and the one line that needs doing. */
                <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="today-meds">
                  {body.meds.flatMap((m) =>
                    Array.from({ length: m.due }, (_, i) => i + 1).map((slot) => (
                      <form key={`${m.id}:${slot}`} action={takeMedAction}>
                        <input type="hidden" name="medId" value={m.id} />
                        <input type="hidden" name="slot" value={slot} />
                        <input type="hidden" name="back" value="/today" />
                        <SubmitButton className={`btn btn-xs ${m.taken.includes(slot) ? "btn-humanos" : "btn-soft"}`} pendingText="…" aria-pressed={m.taken.includes(slot)} data-testid="today-med" data-name={m.name} data-taken={m.taken.includes(slot) ? "1" : "0"}>
                          {m.taken.includes(slot) ? "✓ " : "💊 "}
                          {m.name}
                          {m.due > 1 ? ` ${slot}` : ""}
                        </SubmitButton>
                      </form>
                    )),
                  )}
                  {body.meds
                    .filter((m) => m.line)
                    .map((m) => (
                      <Link key={`${m.id}:line`} href="/body/practices/meds" className={`w-full text-xs hover:underline ${m.line!.tone === "stop" || m.line!.tone === "now" ? "text-danger" : "text-warn"}`} data-testid="today-med-line">
                        {m.name}: {m.line!.text}
                      </Link>
                    ))}
                </div>
              ) : null}
              {workout?.finished ? (
                <div data-testid="today-workout-read">
                  <WorkoutReadCard read={workout} date={v.today} unit={workout.unit} routineId={workout.routineId} compact />
                  <Link href="/body/training" className="mt-1 inline-block text-xs text-ink-2 hover:underline">
                    Each exercise on Training →
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
          {d.brandKitStarter ? (
            <Card title="Your brand" action={<Link href="/settings#brand-kit" className="text-xs text-ink-2 hover:underline">Settings →</Link>}>
              <Link href="/settings#brand-kit" className="font-semibold hover:underline" data-testid="brand-kit-nudge">
                Set your brand kit (5 min)
              </Link>
              <div className="mt-1 text-xs text-ink-3">Your colours, fonts and logo. Until then your decks use the house starter kit.</div>
            </Card>
          ) : null}
          {d.pathwayNext ? (
            <Card title="Next on your pathway" action={<Link href="/pathway" className="text-xs text-ink-2 hover:underline">Pathway →</Link>}>
              <Link href={FIELD_TASKS[d.pathwayNext.key]?.href ?? `/pathway?task=${d.pathwayNext.key}`} className="font-semibold hover:underline" data-testid="pathway-next">
                {d.pathwayNext.name}
              </Link>
              <div className="mt-1 text-xs text-ink-3">+{d.pathwayNext.points} pts when your coach verifies it</div>
            </Card>
          ) : null}
          <Card title="Coming up">
            {d.upcomingTasks.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.upcomingTasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className="truncate">{t.title}</span>
                    <span className="shrink-0 text-xs text-ink-3">{relativeDay(t.dueDate!, v.today)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Nothing scheduled this week yet.</p>
            )}
          </Card>
          <Card title="Level">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">
                {TIER_ICONS[d.tier.current.name]} {d.tier.current.name}
              </span>
              <span className="tabular text-ink-2">{d.points.toLocaleString()} pts</span>
            </div>
            <div className="mt-2">
              <Progress value={d.tier.pct} height={6} />
            </div>
            <div className="mt-1.5 text-xs text-ink-3">{d.tier.next ? `${d.tier.toNext.toLocaleString()} to ${d.tier.next.name}` : "Top tier reached"}</div>
            <Link href="/rewards" className="mt-3 inline-block text-xs text-ink-2 hover:underline">
              See rewards →
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}

type PickTask = { id: string; title: string; focusDate: string | null; dueDate: string | null; urgency: string };

function LockInForm({ openTasks, stillOpen, today, defaultIntention }: { openTasks: PickTask[]; stillOpen: { day: string; tasks: PickTask[] } | null; today: string; defaultIntention: string }) {
  // The last lock-in day's unfinished Top 3 first, unticked, under its own line (rev 418); then the rest, as before.
  const carried = stillOpen?.tasks ?? [];
  const carriedIds = new Set(carried.map((t) => t.id));
  const candidates = [...carried, ...openTasks.filter((t) => !carriedIds.has(t.id)).slice(0, 12)];
  const carriedLabel = stillOpen ? (stillOpen.day === addDays(today, -1) ? "Still open from yesterday" : `Still open from ${formatDate(stillOpen.day, { weekday: "long" })}`) : null;
  return (
    <form action={morningCheckinAction} className="mt-2 space-y-4">
      <div>
        <div className="label">How&apos;s your energy?</div>
        {/* Five equal segments, the emoji over a label that stays on one line (rev 531: "Dragging" spilled, "On fire" wrapped). */}
        <div className="grid grid-cols-5 gap-1.5" data-testid="energy-segments">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="min-w-0 cursor-pointer">
              <input type="radio" name="energy" value={n} defaultChecked={n === 3} className="peer sr-only" />
              <span className="block rounded-lg border px-0.5 py-2 text-center font-medium peer-checked:border-accent peer-checked:bg-white/60 peer-checked:ring-1 peer-checked:ring-accent" data-testid="energy-segment">
                <span className="block text-lg leading-none">{["", "😮‍💨", "😐", "🙂", "😃", "🔥"][n]}</span>
                <span className="mt-1 block whitespace-nowrap text-[11px] leading-tight sm:text-xs">{ENERGY[n]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <Field label="One line: what would make today a win?">
        <input className="field w-full" name="intention" defaultValue={defaultIntention} placeholder="Three real conversations before noon." data-testid="lockin-win" />
      </Field>
      <Top3Picker
        candidates={candidates.map((t) => ({ id: t.id, title: t.title, late: Boolean(t.dueDate && t.dueDate < today), due: t.dueDate ? (t.dueDate === today ? "today" : formatDate(t.dueDate, { day: "numeric", month: "short" })) : undefined }))}
        initiallyChecked={candidates.filter((t) => t.focusDate === today).map((t) => t.id)}
        carried={carriedLabel ? { label: carriedLabel, ids: [...carriedIds] } : undefined}
      />
      <SubmitButton className="btn btn-accent" pendingText="Locking in…">
        Lock it in · +10
      </SubmitButton>
    </form>
  );
}

function CloseForm({ log, activity, owner, today, error, closeKpis }: { log: DailyLog | null; activity: TodayActivity; owner: string | null; today: string; error?: string; closeKpis: { id: string; name: string; unit: string; value: number | null }[] }) {
  // First close: start from what the app already saw today. Editing a close shows what was saved.
  const prefill: Partial<Record<keyof DailyLog, number>> = log?.eveningDoneAt ? {} : { dmsStarted: activity.dmsStarted, conversations: activity.conversations, posts: activity.posts, newLeads: activity.newLeads };
  const n = (key: keyof DailyLog, label: string, hint: string) => {
    const value = log?.eveningDoneAt ? Number(log[key] ?? 0) : (prefill[key] ?? (log ? Number(log[key] ?? 0) : 0));
    return (
      <label key={key} className="block">
        <span className="label">{label}</span>
        {CLOSE_MONEY.includes(key) ? (
          <MoneyInput name={key} defaultValue={value || ""} placeholder="0" data-testid={`close-${key}`} />
        ) : (
          <input className="field tabular" name={key} type="number" min={0} step={1} inputMode="numeric" defaultValue={value} data-testid={`close-${key}`} />
        )}
        <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span>
      </label>
    );
  };
  return (
    <form action={eveningCloseAction} className="mt-2 space-y-4" data-testid="close-form">
      {/* A day's close keeps a draft (rev 444): a refusal, a slip or a lost connection never costs the day's numbers and words. */}
      {owner ? <DraftKeeper id={`close.${owner}.${today}`} /> : null}
      {error ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="close-error">
          {error}
        </p>
      ) : null}
      {!log?.eveningDoneAt && (activity.dmsStarted || activity.conversations || activity.posts || activity.newLeads) ? (
        <p className="rounded-lg bg-surface-2 p-2 text-xs text-ink-2" data-testid="close-prefill">Filled in from what you logged today ({[activity.dmsStarted ? `${activity.dmsStarted} DMs` : "", activity.conversations ? `${activity.conversations} replies` : "", activity.posts ? `${activity.posts} posted` : "", activity.newLeads ? `${activity.newLeads} new leads` : ""].filter(Boolean).join(", ")}). Correct anything, then close. Points already earned during the day aren&apos;t counted twice.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {n("dmsStarted", "DMs started", "+5 each")}
        {n("conversations", "Conversations", "+2 each")}
        {n("callsBooked", "Calls booked", "+25 each")}
        {n("callsHeld", "Calls held", "+10 each")}
        {n("posts", "Posts", "+15 each")}
        {n("offersMade", "Offers made", "Asks count")}
        {n("newLeads", "New leads", "Opt-ins, hand-raises")}
        {n("cashCollected", "Cash collected ($)", "Adds to your goal")}
      </div>
      {closeKpis.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="close-kpis">
          {closeKpis.map((k) => (
            <label key={k.id} className="block">
              <span className="label">{k.name}{k.unit && k.unit !== "count" ? ` (${k.unit})` : ""}</span>
              <input className="field tabular" name={`kpi_${k.id}`} inputMode="decimal" defaultValue={k.value ?? ""} placeholder="0" data-testid={`close-kpi-${k.id}`} />
              <span className="mt-0.5 block text-[11px] text-ink-3">Your KPI, today&apos;s number</span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start">
          <input className="field" name="start" defaultValue={log?.start ?? ""} placeholder="Tomorrow I'll start…" />
        </Field>
        <Field label="Stop">
          <input className="field" name="stop" defaultValue={log?.stop ?? ""} placeholder="I'll stop…" />
        </Field>
        <Field label="Keep">
          <input className="field" name="keep" defaultValue={log?.keep ?? ""} placeholder="I'll keep…" />
        </Field>
      </div>
      <Field label="Biggest win today">
        <input className="field" name="win" defaultValue={log?.win ?? ""} placeholder="Say it out loud. Wins compound." />
      </Field>
      <Field label="Grateful for (optional)">
        <input className="field" name="gratitude" defaultValue={log?.gratitude ?? ""} />
      </Field>
      <details className="rounded-lg border p-3" open={Boolean(log && (log.webinarRegs || log.webinarShows || log.applications))}>
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">🎤 Webinar funnel (optional)</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {n("webinarRegs", "Registrations", "")}
          {n("webinarShows", "Show-ups", "")}
          {n("replayViews", "Replay views", "")}
          {n("applications", "Applications", "")}
        </div>
      </details>
      <details className="rounded-lg border p-3" open={Boolean(log && (log.proofPosts || log.ctaPosts || log.beliefPosts))}>
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">✍️ Content mix (optional)</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {n("proofPosts", "Proof posts", "")}
          {n("ctaPosts", "CTA posts", "")}
          {n("beliefPosts", "Belief posts", "")}
          {n("storiesCreated", "Stories", "")}
          {n("referralAsks", "Referral asks", "")}
        </div>
      </details>
      <details className="rounded-lg border p-3" open={Boolean(log && (log.revContent || log.revWebinar || log.revDm))}>
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">💵 Revenue by source (optional)</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {n("revContent", "From content ($)", "")}
          {n("revWebinar", "From webinar ($)", "")}
          {n("revDm", "From DMs ($)", "")}
        </div>
      </details>
      <SubmitButton className="btn btn-accent" pendingText="Saving your day…">
        Close the day
      </SubmitButton>
    </form>
  );
}
