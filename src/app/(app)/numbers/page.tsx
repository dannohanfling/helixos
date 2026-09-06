import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { BarChart, Sparkline, StreakCalendar } from "@/components/charts";
import { Badge, Card, Disclosure, PageHeader, Progress } from "@/components/ui";
import { setTargetsAction } from "@/lib/actions/targets";
import { addDays, formatDate, isWeekday, rangeDays, startOfWeek } from "@/lib/dates";
import { logsBetween } from "@/lib/queries/daily";
import { TARGET_METRICS, daysInMonth, monthOf, monthProgress } from "@/lib/engine/targets";
import { PILLARS, lastMonths, pillarSummary } from "@/lib/engine/pillars";

export const metadata = { title: "Numbers" };

type Metric = "dmsStarted" | "conversations" | "callsBooked" | "callsHeld" | "posts" | "newLeads" | "cashCollected";
const METRICS: { key: Metric; label: string; money?: boolean }[] = [
  { key: "dmsStarted", label: "DMs started" },
  { key: "conversations", label: "Conversations" },
  { key: "callsBooked", label: "Calls booked" },
  { key: "callsHeld", label: "Calls held" },
  { key: "posts", label: "Posts" },
  { key: "newLeads", label: "New leads" },
  { key: "cashCollected", label: "Cash collected", money: true },
];

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ metric?: string; week?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const metric = (METRICS.find((m) => m.key === sp.metric)?.key ?? "dmsStarted") as Metric;
  const thisMonday = startOfWeek(v.today);
  const weekStart = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? startOfWeek(sp.week) : thisMonday;
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const from12 = addDays(thisMonday, -7 * 11);

  const month = monthOf(v.today);
  const sixMonths = lastMonths(month, 6);
  const [logs, weekLogs, prevLogs, posted, ledger, monthLogs, targetRows, pillarLogs] = await Promise.all([
    logsBetween(v.workspace.id, v.user.id, from12, v.today),
    logsBetween(v.workspace.id, v.user.id, weekStart, weekEnd),
    logsBetween(v.workspace.id, v.user.id, prevStart, addDays(prevStart, 6)),
    db.query.contentItems.findMany({ where: and(eq(schema.contentItems.userId, v.user.id), eq(schema.contentItems.status, "posted")), orderBy: desc(schema.contentItems.engagements), limit: 5 }),
    db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.workspaceId, v.workspace.id), eq(schema.pointsLedger.userId, v.user.id), gte(schema.pointsLedger.createdAt, from12)) }),
    logsBetween(v.workspace.id, v.user.id, `${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`),
    db.query.targets.findMany({ where: and(eq(schema.targets.userId, v.user.id), eq(schema.targets.month, month)) }),
    logsBetween(v.workspace.id, v.user.id, `${sixMonths[0]}-01`, v.today),
  ]);
  const targetMap = Object.fromEntries(targetRows.map((t) => [t.metric, t.target]));
  const progress = monthProgress(monthLogs as unknown as Record<string, number>[], targetMap, month, v.today);
  const hasTargets = progress.some((p) => p.target > 0);
  const funnel = { regs: monthLogs.reduce((a, l) => a + l.webinarRegs, 0), shows: monthLogs.reduce((a, l) => a + l.webinarShows, 0), replays: monthLogs.reduce((a, l) => a + l.replayViews, 0), apps: monthLogs.reduce((a, l) => a + l.applications, 0) };
  const mix = { proof: monthLogs.reduce((a, l) => a + l.proofPosts, 0), cta: monthLogs.reduce((a, l) => a + l.ctaPosts, 0), belief: monthLogs.reduce((a, l) => a + l.beliefPosts, 0), stories: monthLogs.reduce((a, l) => a + l.storiesCreated, 0), referrals: monthLogs.reduce((a, l) => a + l.referralAsks, 0) };
  const rev = { content: monthLogs.reduce((a, l) => a + l.revContent, 0), webinar: monthLogs.reduce((a, l) => a + l.revWebinar, 0), dm: monthLogs.reduce((a, l) => a + l.revDm, 0) };
  const revTotal = rev.content + rev.webinar + rev.dm;
  const monthLabel = formatDate(`${month}-01`, { month: "long", year: "numeric" });
  const pillars = pillarSummary(pillarLogs, month);

  const sum = (rows: typeof logs, k: Metric) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const fmt = (m: (typeof METRICS)[number], n: number) => (m.money ? `$${n.toLocaleString()}` : n.toLocaleString());

  // Weekly series for the last 12 weeks
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(from12, i * 7));
  const weekly = weeks.map((monday) => {
    const rows = logs.filter((l) => l.date >= monday && l.date <= addDays(monday, 6));
    return { monday, rows };
  });
  const chartData = weekly.map((w) => ({ label: formatDate(w.monday, { month: "numeric", day: "numeric" }), value: sum(w.rows, metric), sub: `week of ${formatDate(w.monday)}` }));
  const pointsByWeek = weeks.map((monday) => ledger.filter((p) => p.createdAt.slice(0, 10) >= monday && p.createdAt.slice(0, 10) <= addDays(monday, 6)).reduce((a, p) => a + p.points, 0));

  // Streak calendar (last 12 weeks, weekdays only)
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const calWeeks = weeks.map((monday) => ({
    monday,
    days: rangeDays(monday, addDays(monday, 4)).map((date) => {
      const l = byDate.get(date);
      const level: 0 | 1 | 2 | 3 = !l ? 0 : l.eveningDoneAt && l.morningDoneAt ? 3 : l.eveningDoneAt ? 2 : 1;
      const title = `${formatDate(date, { weekday: "short", month: "short", day: "numeric" })}: ${!l ? "no check-in" : l.eveningDoneAt ? `closed · ${l.dmsStarted} DMs · ${l.posts} posts` : "locked in, not closed"}`;
      return { date, level, title };
    }),
  }));
  const weekdaysSoFar = rangeDays(from12, v.today).filter(isWeekday).length;
  const closedCount = logs.filter((l) => l.eveningDoneAt && isWeekday(l.date)).length;
  const consistency = weekdaysSoFar ? Math.round((closedCount / weekdaysSoFar) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Numbers"
        subtitle="Inputs you control. Outputs follow."
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/numbers?week=${prevStart}&metric=${metric}`} className="btn btn-ghost btn-sm">
              ←
            </Link>
            <span className="font-medium">
              {weekStart === thisMonday ? "This week" : `Week of ${formatDate(weekStart)}`}
            </span>
            <Link href={`/numbers?week=${addDays(weekStart, 7)}&metric=${metric}`} className={`btn btn-ghost btn-sm ${weekStart >= thisMonday ? "pointer-events-none opacity-40" : ""}`}>
              →
            </Link>
          </div>
        }
      />

      <Card className="mb-4" title={`${monthLabel} · targets`} action={<span className="text-xs text-ink-3">{hasTargets ? "actual vs target, paced to today" : "set targets to see pace"}</span>}>
        {hasTargets ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {progress
              .filter((p) => p.target > 0)
              .map((p) => (
                <div key={p.key} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                    <span>{p.label}</span>
                    <Badge tone={p.pace === "ahead" ? "good" : p.pace === "on" ? "accent" : "warn"}>{p.pace === "ahead" ? "ahead" : p.pace === "on" ? "on pace" : "behind"}</Badge>
                  </div>
                  <div className="mt-1 text-xl font-semibold leading-none tabular">
                    {p.money ? `$${p.actual.toLocaleString()}` : p.actual.toLocaleString()} <span className="text-xs font-normal text-ink-3">/ {p.money ? `$${p.target.toLocaleString()}` : p.target.toLocaleString()}</span>
                  </div>
                  <div className="mt-2"><Progress value={p.pct} tone={p.pace === "ahead" ? "good" : p.pace === "on" ? "accent" : "warn"} height={5} /></div>
                  <div className="mt-1 text-[10px] text-ink-3">expected by today: {p.money ? `$${p.expected.toLocaleString()}` : p.expected}</div>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-ink-2">Pick two or three numbers that matter this month. The scoreboard tells you if you&apos;re on pace, not just what you did.</p>
        )}
        <Disclosure summary={<span className="text-xs text-ink-3 underline">{hasTargets ? "Edit targets" : "Set this month's targets"}</span>} className="mt-3">
          <form action={setTargetsAction} className="mt-2 space-y-3">
            <input type="hidden" name="month" value={month} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {TARGET_METRICS.map((m) => (
                <label key={m.key} className="block">
                  <span className="label">{m.label}</span>
                  <input className="field tabular py-1 text-sm" name={m.key} type="number" min={0} defaultValue={targetMap[m.key] ?? ""} placeholder="0" />
                </label>
              ))}
            </div>
            <button className="btn btn-primary btn-sm" type="submit">Save targets</button>
          </form>
        </Disclosure>
        {funnel.regs || funnel.shows || mix.proof || mix.cta || mix.belief || revTotal ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="label">Webinar funnel · month</div>
              <div className="tabular">{funnel.regs} registered → {funnel.shows} showed{funnel.regs ? ` (${Math.round((funnel.shows / funnel.regs) * 100)}%)` : ""} → {funnel.apps} applied</div>
              <div className="text-xs text-ink-3">{funnel.replays} replay views</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="label">Content mix · month</div>
              <div className="tabular">🏆 {mix.proof} proof · 📣 {mix.cta} CTA · 🧠 {mix.belief} belief</div>
              <div className="text-xs text-ink-3">{mix.stories} stories · {mix.referrals} referral asks</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="label">Revenue by source · month</div>
              <div className="tabular">${revTotal.toLocaleString()} total</div>
              <div className="text-xs text-ink-3">content ${rev.content.toLocaleString()} · webinar ${rev.webinar.toLocaleString()} · DMs ${rev.dm.toLocaleString()}</div>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="mb-4" title={`Revenue by pillar · ${monthLabel}`} action={<span className="text-xs text-ink-3">from your evening close</span>} id="pillars">
        <p className="mb-3 text-sm text-ink-2">
          Which of the things you&apos;re building is actually making you money.{" "}
          {pillars.leader ? (
            <>
              This month it&apos;s <b>{pillars.leader.label.toLowerCase()}</b> at ${pillars.leader.revenue.toLocaleString()} ({pillars.leader.share}%).
            </>
          ) : null}{" "}
          <span className="text-ink-3">{pillars.honesty}</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="pillars">
          {pillars.current.pillars.map((p) => (
            <div key={p.key} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {p.icon} {p.label}
                </span>
                <span className="tabular text-xs text-ink-3">{p.share}%</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular">${p.revenue.toLocaleString()}</div>
              <Progress value={p.share} tone={pillars.leader?.key === p.key ? "good" : "accent"} height={6} />
              <div className="mt-2 text-xs text-ink-3">{p.activity.map((a) => `${a.value.toLocaleString()} ${a.label}`).join(" · ")}</div>
              <div className="mt-1 text-[11px] text-ink-3">{PILLARS.find((x) => x.key === p.key)?.teaches}</div>
            </div>
          ))}
        </div>
        {pillars.withData.length > 1 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs tabular">
              <thead className="text-left uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="py-1 pr-3">Month</th>
                  <th className="py-1 pr-3 text-right">Total</th>
                  {PILLARS.map((p) => (
                    <th key={p.key} className="py-1 pr-3 text-right">
                      {p.icon} {p.label.split(" ")[0]}
                    </th>
                  ))}
                  <th className="py-1 text-right">Closed days</th>
                </tr>
              </thead>
              <tbody>
                {pillars.withData.map((m) => (
                  <tr key={m.month} className="border-t">
                    <td className="py-1 pr-3">{formatDate(`${m.month}-01`, { month: "short", year: "2-digit" })}</td>
                    <td className="py-1 pr-3 text-right font-medium">${m.total.toLocaleString()}</td>
                    {m.pillars.map((p) => (
                      <td key={p.key} className="py-1 pr-3 text-right">
                        ${p.revenue.toLocaleString()} <span className="text-ink-3">({p.share}%)</span>
                      </td>
                    ))}
                    <td className="py-1 text-right text-ink-3">{m.closedDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-3">The month-by-month trend appears once two months have closed days.</p>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {METRICS.map((m) => {
          const cur = sum(weekLogs, m.key);
          const prev = sum(prevLogs, m.key);
          const delta = cur - prev;
          const spark = weekly.map((w) => sum(w.rows, m.key));
          const active = m.key === metric;
          return (
            <Link key={m.key} href={`/numbers?metric=${m.key}&week=${weekStart}`} className={`card p-3 transition hover:border-ink ${active ? "border-accent" : ""}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{m.label}</div>
              <div className="mt-1 text-2xl font-semibold leading-none">{fmt(m, cur)}</div>
              <div className={`mt-1 text-[11px] ${delta > 0 ? "text-good" : delta < 0 ? "text-danger" : "text-ink-3"}`}>
                {delta === 0 ? "same as last week" : `${delta > 0 ? "▲" : "▼"} ${fmt(m, Math.abs(delta))} vs last week`}
              </div>
              <div className="mt-2">
                <Sparkline values={spark} width={110} height={24} />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title={`${METRICS.find((m) => m.key === metric)!.label} · last 12 weeks`} action={<span className="text-xs text-ink-3">Highlighted: selected week</span>}>
          <BarChart data={chartData} valueLabel={METRICS.find((m) => m.key === metric)!.label.toLowerCase()} highlightIndex={weeks.indexOf(weekStart)} />
          <details className="mt-3">
            <summary className="text-xs text-ink-3 underline">Table view</summary>
            <table className="mt-2 w-full text-xs tabular">
              <thead className="text-left text-ink-2">
                <tr>
                  <th className="py-1">Week of</th>
                  {METRICS.map((m) => (
                    <th key={m.key} className="py-1 text-right">
                      {m.label}
                    </th>
                  ))}
                  <th className="py-1 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {weekly.map((w, i) => (
                  <tr key={w.monday}>
                    <td className="py-1">{formatDate(w.monday)}</td>
                    {METRICS.map((m) => (
                      <td key={m.key} className="py-1 text-right">
                        {fmt(m, sum(w.rows, m.key))}
                      </td>
                    ))}
                    <td className="py-1 text-right">{pointsByWeek[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>

        <div className="space-y-4">
          <Card title="Consistency" action={<span className="text-xs text-ink-3">{consistency}% of weekdays closed</span>}>
            <StreakCalendar weeks={calWeeks} labelFor={(m) => (weeks.indexOf(m) % 4 === 0 ? formatDate(m, { month: "short" }) : "")} />
            <div className="mt-2 flex items-center gap-3 text-[10px] text-ink-3">
              <span>Less</span>
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--surface-2)" }} />
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "color-mix(in oklab, var(--good) 35%, var(--surface))" }} />
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--good)" }} />
              <span>More</span>
            </div>
          </Card>
          <Card title="Top posts">
            {posted.length ? (
              <ul className="space-y-2 text-sm">
                {posted.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/content/${p.id}`} className="min-w-0 truncate hover:underline">
                      {p.title}
                    </Link>
                    <span className="shrink-0 text-xs text-ink-2 tabular">
                      👍 {p.engagements} · 🆕 {p.leads}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Post something and its numbers land here.</p>
            )}
          </Card>
          <Card title="This week's reflections">
            {weekLogs.filter((l) => l.win).length ? (
              <ul className="space-y-1.5 text-sm">
                {weekLogs
                  .filter((l) => l.win)
                  .map((l) => (
                    <li key={l.id}>
                      <span className="text-xs text-ink-3">{formatDate(l.date, { weekday: "short" })}</span> {l.win}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Close a day and your wins collect here.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
