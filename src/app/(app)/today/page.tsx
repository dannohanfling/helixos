import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { eveningCloseAction, morningCheckinAction, repairStreakAction } from "@/lib/actions/daily";
import type { TodayActivity } from "@/lib/queries/daily";
import type { DailyLog } from "@/db/schema";
import { completeCurriculumDayAction } from "@/lib/actions/pathway";
import { setContentStatusAction } from "@/lib/actions/content";
import { todayData } from "@/lib/queries/today";
import { NewTaskForm } from "@/components/new-task-form";
import { TaskRow } from "@/components/task-row";
import { Badge, Card, Empty, Field, Progress } from "@/components/ui";
import { formatDate, relativeDay } from "@/lib/dates";
import { streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { TIER_ICONS } from "@/lib/engine/tiers";
import { closedDates } from "@/lib/queries/daily";

export const metadata = { title: "Today" };

function greeting(hour: number, name: string): string {
  const first = name.split(" ")[0];
  if (hour < 5) return `Still up, ${first}?`;
  if (hour < 12) return `Morning, ${first}.`;
  if (hour < 17) return `Afternoon, ${first}.`;
  return `Evening, ${first}.`;
}

const ENERGY = ["", "Dragging", "Slow", "Steady", "Bright", "On fire"];

export default async function TodayPage() {
  const v = await requireViewer();
  const d = await todayData(v);
  const closed = await closedDates(v.workspace.id, v.user.id);
  const streakDayIfClosedNow = d.log?.eveningDoneAt ? d.log.streakDay : weeklyStreakDay(closed, v.today);
  const bonusIfClosedNow = streakBonus(streakDayIfClosedNow);
  const morningDone = Boolean(d.log?.morningDoneAt);
  const eveningDone = Boolean(d.log?.eveningDoneAt);
  const openFocus = d.focusTasks.filter((t) => t.status !== "done");
  const doneFocus = d.focusTasks.filter((t) => t.status === "done");
  const boardTasks = [...d.overdueTasks, ...d.dueTasks.filter((t) => t.focusDate !== v.today)];
  const goalPct = d.goal ? Math.round((d.goal.actual / Math.max(d.goal.target, 1)) * 100) : 0;
  const primary = d.actions[0];
  const rest = d.actions.slice(1, 6);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-ink-2">{formatDate(v.today, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting(v.hour, v.user.name)}</h1>
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
                <button className="btn btn-primary btn-sm" type="submit">
                  Repair the streak
                </button>
              </form>
            ) : (
              <a href="#close" className="btn btn-soft btn-sm">
                Start day 1 tonight
              </a>
            )}
          </div>
        </section>
      ) : null}

      {/* Next best action */}
      <section className="mb-5 grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className={`card p-5 ${primary.tone === "warning" ? "border-warn" : "border-accent"}`} style={{ background: primary.tone === "warning" ? "var(--warn-soft)" : "var(--accent-soft)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Next best action</div>
          <div className="mt-1 text-xl font-bold">{primary.title}</div>
          <div className="mt-1 text-sm text-ink-2">{primary.why}</div>
          <div className="mt-3 flex items-center gap-3">
            <Link href={primary.href} className="btn btn-primary">
              {primary.cta}
            </Link>
            {primary.points ? <span className="text-sm font-semibold text-accent-ink">+{primary.points} pts</span> : null}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Then</div>
          <ul className="mt-2 space-y-2">
            {rest.length ? (
              rest.map((a) => (
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
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-2">{d.goal.title}</span>
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

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {/* Morning lock-in */}
          <Card id="checkin" title={morningDone ? "Today's lock-in" : "Morning lock-in"} action={morningDone ? <Badge tone="good">Done · +10</Badge> : <Badge tone="accent">+10 pts</Badge>}>
            {morningDone ? (
              <div className="space-y-3">
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
                        <TaskRow key={t.id} task={t} today={v.today} compact />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-2">No top 3 picked. Star a task below to add one.</p>
                  )}
                </div>
                <details>
                  <summary className="text-xs text-ink-3 underline">Redo lock-in</summary>
                  <LockInForm openTasks={d.openTasks} today={v.today} defaultIntention={d.log?.intention ?? ""} />
                </details>
              </div>
            ) : (
              <LockInForm openTasks={d.openTasks} today={v.today} defaultIntention="" />
            )}
          </Card>

          {/* Today's board */}
          <Card title="Also on your plate" action={<NewTaskForm today={v.today} />}>
            {boardTasks.length ? (
              <div className="-mx-2 divide-y">
                {boardTasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={v.today} />
                ))}
              </div>
            ) : (
              <Empty icon="🧹" title="Board is clear" hint="Nothing overdue, nothing else due today." />
            )}
          </Card>

          {/* Content + conversations */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Content to ship" action={<Link href="/content" className="text-xs text-ink-2 hover:underline">All content →</Link>}>
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
                          <button className="btn btn-soft btn-xs" type="submit">
                            Posted ✓
                          </button>
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
                <details>
                  <summary className="text-xs text-ink-3 underline">Edit today&apos;s numbers</summary>
                  <CloseForm log={d.log} activity={d.activity} />
                </details>
              </div>
            ) : (
              <CloseForm log={d.log} activity={d.activity} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {d.curriculumDay ? (
            <Card title={`30-day build · Day ${d.curriculumDay.day}`} action={<Badge tone="accent">+{d.curriculumDay.points}</Badge>}>
              <div className="font-semibold">{d.curriculumDay.title}</div>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{d.curriculumDay.instructions}</p>
              <div className="mt-2 text-xs text-ink-3">
                {d.curriculumDay.week} · {d.curriculumDay.estTime}
              </div>
              <form action={completeCurriculumDayAction} className="mt-3">
                <input type="hidden" name="day" value={d.curriculumDay.day} />
                <button className="btn btn-accent btn-sm" type="submit">
                  Done, log it
                </button>
              </form>
            </Card>
          ) : null}
          {d.pathwayNext ? (
            <Card title="Next on your pathway" action={<Link href="/pathway" className="text-xs text-ink-2 hover:underline">Pathway →</Link>}>
              <Link href={`/pathway?task=${d.pathwayNext.key}`} className="font-semibold hover:underline">
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

function LockInForm({ openTasks, today, defaultIntention }: { openTasks: { id: string; title: string; focusDate: string | null; dueDate: string | null; urgency: string }[]; today: string; defaultIntention: string }) {
  const candidates = openTasks.slice(0, 12);
  return (
    <form action={morningCheckinAction} className="mt-2 space-y-4">
      <div>
        <div className="label">How&apos;s your energy?</div>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="energy" value={n} defaultChecked={n === 3} className="peer sr-only" />
              <span className="block rounded-lg border px-1 py-2 text-center text-xs font-medium peer-checked:border-accent peer-checked:bg-accent-soft">
                <span className="block text-base">{["", "😮‍💨", "😐", "🙂", "😃", "🔥"][n]}</span>
                {ENERGY[n]}
              </span>
            </label>
          ))}
        </div>
      </div>
      <Field label="One line: what would make today a win?">
        <input className="field" name="intention" defaultValue={defaultIntention} placeholder="Three real conversations before noon." />
      </Field>
      <div>
        <div className="label">Pick your top 3</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {candidates.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="focus" value={t.id} defaultChecked={t.focusDate === today} />
              <span className="truncate">{t.title}</span>
              {t.dueDate && t.dueDate < today ? <span className="ml-auto shrink-0 text-[10px] font-semibold text-danger">late</span> : null}
            </label>
          ))}
        </div>
        <input className="field mt-2" name="newFocus" placeholder="…or type a new top-3 task" />
      </div>
      <button className="btn btn-accent" type="submit">
        Lock it in · +10
      </button>
    </form>
  );
}

function CloseForm({ log, activity }: { log: DailyLog | null; activity: TodayActivity }) {
  // First close: start from what the app already saw today. Editing a close shows what was saved.
  const prefill: Partial<Record<keyof DailyLog, number>> = log?.eveningDoneAt ? {} : { dmsStarted: activity.dmsStarted, conversations: activity.conversations, posts: activity.posts, newLeads: activity.newLeads };
  const n = (key: keyof DailyLog, label: string, hint: string) => (
    <label key={key} className="block">
      <span className="label">{label}</span>
      <input className="field tabular" name={key} type="number" min={0} step={key === "cashCollected" ? 1 : 1} inputMode="numeric" defaultValue={log?.eveningDoneAt ? Number(log[key] ?? 0) : (prefill[key] ?? (log ? Number(log[key] ?? 0) : 0))} />
      <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span>
    </label>
  );
  return (
    <form action={eveningCloseAction} className="mt-2 space-y-4">
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
        <div className="mt-2 grid grid-cols-3 gap-3">
          {n("revContent", "From content ($)", "")}
          {n("revWebinar", "From webinar ($)", "")}
          {n("revDm", "From DMs ($)", "")}
        </div>
      </details>
      <button className="btn btn-accent" type="submit">
        Close the day
      </button>
    </form>
  );
}
