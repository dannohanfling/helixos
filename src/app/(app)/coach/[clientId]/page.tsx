import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { addCoachNoteAction, nudgeMemberAction } from "@/lib/actions/coach";
import { Badge, Card, Field, PageHeader, Progress } from "@/components/ui";
import { TIER_ICONS, tierProgress } from "@/lib/engine/tiers";
import { runningStreak } from "@/lib/engine/streak";
import { simplePath } from "@/lib/engine/pathway";
import { pillarSummary } from "@/lib/engine/pillars";
import { catalogue } from "@/lib/engine/rewards";
import { loadRewardsConfig } from "@/lib/rewards-config";
import { totalPoints } from "@/lib/queries/points";
import { closedDates, logsBetween } from "@/lib/queries/daily";
import { tasksFromNotes } from "@/lib/queries/tasks";
import { daysSinceNudge } from "@/lib/nudge";
import { addDays, daysBetween, formatDate, formatDateTime, todayInTz } from "@/lib/dates";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

export const metadata = { title: "Client" };

/**
 * One client, before a call. The page answers "what do I say to this person today": where they are, what they wrote in
 * their own words, what's stuck, what they claimed, what they've built. Then the call's decisions go back in as tasks.
 */
export default async function CoachClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const v = await requireCoach();
  const { clientId } = await params;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientId), eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client")) });
  if (!m) notFound();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!u) notFound();
  const ws = v.workspace.id;
  const tz = m.timezone || v.workspace.timezone;
  const today = todayInTz(tz);
  const month = today.slice(0, 7);
  const [points, closed, recent, monthLogs, goal, stages, library, progress, claims, notes, offers, webinars, ladders, content] = await Promise.all([
    totalPoints(ws, m.userId),
    closedDates(ws, m.userId),
    logsBetween(ws, m.userId, addDays(today, -20), today),
    logsBetween(ws, m.userId, addDays(`${month}-01`, -150), today),
    db.query.goals.findFirst({ where: and(eq(schema.goals.workspaceId, ws), eq(schema.goals.userId, m.userId), eq(schema.goals.primary, true)) }),
    db.query.pathwayStages.findMany({ orderBy: schema.pathwayStages.order }),
    db.query.libraryTasks.findMany(),
    db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, ws), eq(schema.pathwayProgress.userId, m.userId)) }),
    db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, ws), eq(schema.rewardClaims.userId, m.userId)), orderBy: desc(schema.rewardClaims.createdAt) }),
    db.query.coachNotes.findMany({ where: and(eq(schema.coachNotes.workspaceId, ws), eq(schema.coachNotes.membershipId, m.id)), orderBy: [desc(schema.coachNotes.date), desc(schema.coachNotes.createdAt)], limit: 20 }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, ws), eq(schema.offers.userId, m.userId)), orderBy: desc(schema.offers.createdAt) }),
    db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, ws), eq(schema.webinars.userId, m.userId)), orderBy: desc(schema.webinars.createdAt) }),
    db.query.ladders.findMany({ where: and(eq(schema.ladders.workspaceId, ws), eq(schema.ladders.userId, m.userId)), orderBy: desc(schema.ladders.createdAt) }),
    db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, ws), eq(schema.contentItems.userId, m.userId)), orderBy: desc(schema.contentItems.createdAt) }),
  ]);
  const noteTasks = await tasksFromNotes(ws, notes.map((n) => n.id));
  const tier = tierProgress(points);
  const streak = runningStreak(closed, today);
  const todayLog = recent.find((l) => l.date === today);
  const lastActive = [...closed, ...recent.filter((l) => l.morningDoneAt).map((l) => l.date)].sort().at(-1) ?? null;
  const daysSilent = lastActive ? daysBetween(lastActive, today) : null;
  const path = simplePath(stages, library, progress);
  const stage = stages.find((s) => s.key === path.stageKey);
  const libByKey = new Map(library.map((l) => [l.key, l]));
  const byStatus = (st: (typeof progress)[number]["status"]) => progress.filter((p) => p.status === st);
  const verified = byStatus("verified").length;
  const waiting = byStatus("submitted");
  const stuck = byStatus("revision");
  const pillars = pillarSummary(monthLogs, month);
  const linkOf = new Map(catalogue(rewards, prizes, loadRewardsConfig()).map((i) => [i.name, i.bookingUrl]));
  const nudgedAgo = daysSinceNudge(m.lastNudgedAt, new Date(), v.tz, v.today);
  const words = recent.filter((l) => l.intention || l.win || l.gratitude || l.eveningDoneAt).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const posted = content.filter((c) => c.status === "posted");
  const built = [
    { label: "Offers", count: offers.length, last: offers[0] ? `${offers[0].name} · ${offers[0].status}` : null },
    { label: "Webinars", count: webinars.length, last: webinars[0] ? `${webinars[0].title} · ${webinars[0].status}` : null },
    { label: "Comment ladders", count: ladders.length, last: ladders[0] ? `${ladders[0].postName || "Untitled"} · ${ladders[0].status}` : null },
    { label: "Content posted", count: posted.length, last: posted[0]?.postedAt ? `${posted[0].title} · ${formatDate(posted[0].postedAt.slice(0, 10))}` : posted[0]?.title ?? null },
  ];
  const when = (iso: string) => formatDateTime(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z", v.tz);

  return (
    <>
      <PageHeader
        title={`${u.avatarEmoji ?? ""} ${u.name}`.trim()}
        subtitle={`${m.businessName ? `${m.businessName} · ` : ""}${m.programTier} · joined ${formatDate(m.createdAt.slice(0, 10))} · ${u.email}`}
        action={
          <span className="flex items-center gap-2">
            {nudgedAgo === 0 ? (
              <span className="text-xs text-ink-3">nudged today</span>
            ) : (
              <form action={nudgeMemberAction}>
                <input type="hidden" name="membershipId" value={m.id} />
                <button className="btn btn-soft btn-sm" type="submit" title="Send the comeback email now">
                  Nudge{nudgedAgo !== null ? ` · last ${nudgedAgo}d ago` : ""}
                </button>
              </form>
            )}
            <Link href="/coach" className="btn btn-ghost btn-sm">
              All clients
            </Link>
          </span>
        }
      />

      {/* Where they are, in one strip */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="client-strip">
        <Stat label="Tier" value={`${TIER_ICONS[tier.current.name]} ${tier.current.name}`} sub={`${points.toLocaleString()} pts${tier.next ? ` · ${tier.toNext.toLocaleString()} to ${tier.next.name}` : ""}`} />
        <Stat label="Streak" value={`🔥 ${streak}`} sub={streak ? "weekday streak alive" : "no streak right now"} />
        <Stat label="Today" value={`${todayLog?.morningDoneAt ? "☀️" : "○"} ${todayLog?.eveningDoneAt ? "🌙" : "○"}`} sub={todayLog?.morningDoneAt ? (todayLog.eveningDoneAt ? "locked in and closed" : "locked in, not closed") : "not locked in yet"} />
        <Stat label="Last active" value={daysSilent === null ? "never" : daysSilent === 0 ? "today" : daysSilent === 1 ? "yesterday" : `${daysSilent}d ago`} sub={lastActive ? formatDate(lastActive) : "no lock-in or close yet"} tone={daysSilent !== null && daysSilent >= 3 ? "warn" : undefined} />
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Goal</div>
          {goal && goal.target > 0 ? (
            <>
              <div className="mt-1 truncate text-sm font-semibold" title={goal.title}>
                {goal.title}
              </div>
              <div className="mt-1 text-xs text-ink-2 tabular">
                {goal.unit === "$" ? `$${goal.actual.toLocaleString()} of $${goal.target.toLocaleString()}` : `${goal.actual.toLocaleString()} of ${goal.target.toLocaleString()} ${goal.unit}`} · {goal.period}
              </div>
              <div className="mt-2">
                <Progress value={Math.min(100, Math.round((goal.actual / goal.target) * 100))} tone={goal.actual >= goal.target ? "good" : "accent"} height={6} />
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-ink-2">No goal set yet. Worth asking.</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <Card title="Call notes" action={<span className="text-xs text-ink-3">what you decide becomes their tasks</span>}>
            <form action={addCoachNoteAction} className="space-y-3" data-testid="note-form">
              <input type="hidden" name="membershipId" value={m.id} />
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <Field label="Call date">
                  <input className="field" type="date" name="date" defaultValue={v.today} />
                </Field>
                <Field label="Tasks land">
                  <select className="field" name="due" defaultValue="today">
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="week">Within a week</option>
                  </select>
                </Field>
              </div>
              <Field label="Notes" hint="What was decided. Kept here, for you.">
                <textarea className="field" name="body" rows={4} />
              </Field>
              <Field label="Tasks for them" hint="One per line. Each becomes a task in their Today and Tasks, marked as from this call.">
                <textarea className="field" name="tasks" rows={3} />
              </Field>
              <button className="btn btn-primary btn-sm" type="submit">
                Save note and assign tasks
              </button>
            </form>
            {notes.length ? (
              <ul className="mt-4 divide-y" data-testid="note-list">
                {notes.map((n) => {
                  const mine = noteTasks.filter((t) => t.sourceRef === n.id);
                  return (
                    <li key={n.id} className="py-3 text-sm" data-testid="note-row">
                      <div className="text-xs font-semibold text-ink-2">{formatDate(n.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>
                      <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                      {mine.length ? (
                        <ul className="mt-2 space-y-0.5 text-xs">
                          {mine.map((t) => (
                            <li key={t.id} className={t.status === "done" ? "text-good" : "text-ink-2"}>
                              {t.status === "done" ? "✓" : "○"} {t.title}
                              {t.dueDate ? <span className="text-ink-3"> · due {formatDate(t.dueDate)}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>
          <Card title="In their words" action={<span className="text-xs text-ink-3">last {words.length} days they showed up</span>}>
            {words.length ? (
              <ul className="divide-y" data-testid="their-words">
                {words.map((l) => (
                  <li key={l.date} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                      <span className="font-semibold text-ink-2">{formatDate(l.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span>{l.morningDoneAt ? "☀️" : "○"}{l.eveningDoneAt ? "🌙" : "○"}</span>
                      {l.energy ? <span>· energy {l.energy}/5</span> : null}
                      {l.eveningDoneAt ? <span className="tabular">· {l.dmsStarted} DMs · {l.conversations} convos · {l.callsBooked} booked · {l.callsHeld} held · {l.posts} posts{l.cashCollected ? ` · $${l.cashCollected.toLocaleString()}` : ""}</span> : null}
                    </div>
                    {l.intention ? <p className="mt-1"><span className="text-ink-3">Win for the day:</span> {l.intention}</p> : null}
                    {l.win ? <p className="mt-0.5"><span className="text-ink-3">Win:</span> {l.win}</p> : null}
                    {l.gratitude ? <p className="mt-0.5"><span className="text-ink-3">Grateful:</span> {l.gratitude}</p> : null}
                    {l.start || l.stop || l.keep ? <p className="mt-0.5 text-xs text-ink-2">{[l.start && `Start: ${l.start}`, l.stop && `Stop: ${l.stop}`, l.keep && `Keep: ${l.keep}`].filter(Boolean).join(" · ")}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Nothing logged in the last three weeks. That is the conversation.</p>
            )}
          </Card>

        </div>

        <div className="space-y-4">
          <Card title="Pathway" action={<Badge tone="neutral">{verified} verified</Badge>}>
            <p className="text-sm">
              {path.allDone ? "Every stage done." : <>Stage {stage?.order ?? "?"}: <b>{stage?.name ?? "—"}</b> · {path.doneCount}/{path.pathCount} of this stage&apos;s path done</>}
            </p>
            {waiting.length ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent">Waiting on you</div>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {waiting.map((p) => (
                    <li key={p.id}>
                      {libByKey.get(p.libraryTaskKey)?.name ?? p.libraryTaskKey} <span className="text-xs text-ink-3">· {p.submittedAt ? formatDate(p.submittedAt.slice(0, 10)) : ""}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/coach" className="mt-1 inline-block text-xs underline">
                  Review on the coach page
                </Link>
              </div>
            ) : null}
            {stuck.length ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-warn">Sent back for revision</div>
                <ul className="mt-1 space-y-1 text-sm">
                  {stuck.map((p) => (
                    <li key={p.id}>
                      {libByKey.get(p.libraryTaskKey)?.name ?? p.libraryTaskKey}
                      {p.coachFeedback ? <div className="text-xs text-ink-2">Your note: {p.coachFeedback}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!waiting.length && !stuck.length ? <p className="mt-2 text-xs text-ink-3">Nothing waiting on you, nothing sent back.</p> : null}
          </Card>

          <Card title="Claimed rewards">
            {claims.length ? (
              <ul className="divide-y text-sm" data-testid="client-claims">
                {claims.map((c) => {
                  const link = linkOf.get(c.rewardName);
                  const booking = c.bookedAt ? `booked for ${when(c.bookedAt)}` : !link ? "no next step set yet" : c.bookingOpenedAt ? `opened the booking link ${when(c.bookingOpenedAt)}` : "hasn't opened the booking link yet";
                  return (
                    <li key={c.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>{c.rewardName}</span>
                        <span className="text-xs text-ink-3">{when(c.createdAt)} · {c.pointsSpent ? `−${c.pointsSpent.toLocaleString()} pts` : "milestone"}</span>
                      </div>
                      <div className={`text-xs ${c.bookedAt ? "text-good" : link && !c.bookingOpenedAt ? "text-warn" : "text-ink-3"}`}>{booking}</div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Nothing claimed yet.</p>
            )}
          </Card>

          <Card title="What they've built">
            <ul className="space-y-1.5 text-sm" data-testid="built">
              {built.map((b) => (
                <li key={b.label} className="flex items-baseline justify-between gap-3">
                  <span>
                    {b.label} <b className="tabular">{b.count}</b>
                  </span>
                  <span className="min-w-0 truncate text-right text-xs text-ink-3">{b.last ?? "none yet"}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`Revenue by pillar · ${formatDate(`${month}-01`, { month: "long" })}`}>
            {pillars.leader ? (
              <p className="text-sm">
                Leading: <b>{pillars.leader.label}</b> at ${pillars.leader.revenue.toLocaleString()} ({pillars.leader.share}%).
              </p>
            ) : (
              <p className="text-sm text-ink-2">No revenue logged in their evening close this month.</p>
            )}
            <div className="mt-3 space-y-2" data-testid="client-pillars">
              {pillars.current.pillars.map((p) => (
                <div key={p.key}>
                  <div className="flex justify-between text-xs">
                    <span>
                      {p.icon} {p.label}
                    </span>
                    <span className="tabular text-ink-2">${p.revenue.toLocaleString()} · {p.share}%</span>
                  </div>
                  <Progress value={p.share} tone={pillars.leader?.key === p.key ? "good" : "accent"} height={5} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {sub ? <div className="text-xs text-ink-2">{sub}</div> : null}
    </div>
  );
}
