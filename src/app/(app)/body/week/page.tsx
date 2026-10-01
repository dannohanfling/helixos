import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Stat } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { WeekSummary } from "@/components/body/week-summary";
import { summariseWeekAction } from "@/lib/actions/body";
import { FLAG_ICON, isDayFlag } from "@/lib/engine/body-flags";
import { addDays, formatDate, startOfWeek } from "@/lib/dates";
import { MARK_ICON, fmtMacro } from "@/lib/engine/body";
import { fmtMetric } from "@/lib/engine/body-scale";
import { fmtHours } from "@/lib/engine/body-recovery";
import { bodyRange, bodyWeek, requireBodyEnabled } from "@/lib/queries/body";
import { BarChart, StreakCalendar } from "@/components/charts";
import { RangePicker } from "@/components/body/range-picker";
import { isRangeKey, monthLabelFor, rangeBounds, rateText } from "@/lib/engine/body-range";

export const metadata = { title: "HumanOS · This week" };

/** "+1.2" / "−0.8" beside a number, muted when nothing changed; nothing when last week has no figure. */
function Delta({ value, unit = "", better, vs = "vs last week" }: { value: number | null; unit?: string; better?: "down" | "up"; vs?: string }) {
  if (value == null) return null;
  const tone = value === 0 || !better ? "text-ink-3" : (better === "down" ? value < 0 : value > 0) ? "text-good" : "text-warn";
  return (
    <span className={`text-xs ${tone}`} data-testid="week-delta">
      {value > 0 ? "▲ +" : value < 0 ? "▼ −" : "= "}
      {Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}
      {unit} {vs}
    </span>
  );
}

/** The same tiles over a month, 90 days or a year (phase 10b), with per-week bars, the routines that ran and the calendar strip. */
async function RangeView({ v, range, from }: { v: Awaited<ReturnType<typeof requireViewer>>; range: "month" | "90d" | "year"; from: string | null }) {
  const dates = { addDays, startOfWeek };
  const b = rangeBounds(range, from, v.today, dates);
  const r = await bodyRange(v.workspace.id, v.user.id, b, v.today);
  if (!r) redirect("/body");
  const unit = r.settings.weightUnit;
  const n = r.nutrition;
  const mondays = r.training.weeks.map((w) => w.monday);
  const label = monthLabelFor(mondays, (d) => formatDate(d, { month: "short" }));
  return (
    <>
      <HumanosHeader title={b.label} subtitle={`${formatDate(b.from, { month: "short", day: "numeric", year: "numeric" })} to ${formatDate(b.to, { month: "short", day: "numeric", year: "numeric" })}. Averages over the days with something logged.`} />
      <RangePicker path="/body/week" bounds={b} today={v.today} />
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Nutrition</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="range-nutrition" data-logged={n.daysLogged} data-in-band={n.daysInBand}>
        <Stat label="Days logged" value={`${n.daysLogged} of ${n.daysPassed}`} sub={n.daysJudged ? `${n.daysInBand} of ${n.daysJudged} finished days in band` : "In band once a day with targets finishes"} />
        <Stat label="Calories a day" value={n.avgCal != null ? fmtMacro("cal", n.avgCal) : "—"} sub={<Delta value={n.avgCal != null && r.prevNutrition.avgCal != null ? Math.round(n.avgCal - r.prevNutrition.avgCal) : null} vs="vs the span before" />} />
        <Stat label="Protein a day" value={n.avgP != null ? `${fmtMacro("p", n.avgP)} g` : "—"} sub={n.avgPFloor != null ? `floor ${fmtMacro("p", n.avgPFloor)} g` : ""} />
        <Stat label="Fat a day" value={n.avgF != null ? `${fmtMacro("f", n.avgF)} g` : "—"} sub={n.avgFCeiling != null ? `ceiling ${fmtMacro("f", n.avgFCeiling)} g` : ""} />
      </div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Training</h2>
      <div className="mb-3 grid grid-cols-3 gap-3" data-testid="range-training" data-sessions={r.training.sessions} data-sets={r.training.sets} data-prs={r.training.prs}>
        <Stat label="Sessions" value={String(r.training.sessions)} sub={`${r.training.perWeekSessions.length} week${r.training.perWeekSessions.length === 1 ? "" : "s"}`} />
        <Stat label="Sets" value={String(r.training.sets)} sub={r.training.sessions ? `${Math.round(r.training.sets / r.training.sessions)} a session` : ""} />
        <Stat label="PRs" value={String(r.training.prs)} sub={r.training.prs ? "🏆" : "set in this range"} />
      </div>
      <Card className="mb-4" title="Sessions a week">
        <BarChart data={r.training.perWeekSessions.map((w, i, all) => ({ label: all.length > 8 && i % 2 ? "" : formatDate(w.monday, { month: "short", day: "numeric" }), value: w.value ?? 0, sub: `${r.training.perWeekSets.find((x) => x.monday === w.monday)?.value ?? 0} sets` }))} valueLabel="sessions" height={120} />
        <div className="mt-3">
          <StreakCalendar weeks={r.training.weeks} rows={7} tone="humanos" labelFor={label} />
        </div>
        {r.training.routines.length ? (
          <p className="mt-2 text-xs text-ink-2" data-testid="range-routines">
            {r.training.routines.map((x) => `${x.name} × ${x.times}`).join(" · ")}
          </p>
        ) : null}
      </Card>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Weight, sleep and practices</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="range-rest" data-weigh-days={r.weigh.days} data-sleep-nights={r.sleep.summary.nights} data-habits-kept={r.habits.kept} data-habits-due={r.habits.due}>
        <Stat label="Weight" value={r.weigh.last?.values.weight != null ? fmtMetric("weight", r.weigh.last.values.weight, unit) : "—"} sub={r.weigh.change.weight != null ? <span>{r.weigh.days} weigh-ins · <Delta value={unit === "kg" ? Math.round((r.weigh.change.weight / 2.20462) * 10) / 10 : r.weigh.change.weight} unit={` ${unit}`} vs="over the range" /></span> : `${r.weigh.days} weigh-in${r.weigh.days === 1 ? "" : "s"}`} />
        <Stat label="Body fat" value={r.weigh.last?.values.bf != null ? fmtMetric("bf", r.weigh.last.values.bf, unit) : "—"} sub={r.weigh.change.bf != null ? <Delta value={r.weigh.change.bf} unit="%" better="down" vs="over the range" /> : ""} />
        <Stat label="Sleep a night" value={r.sleep.summary.avg != null ? fmtHours(r.sleep.summary.avg) : "—"} sub={r.sleep.summary.nights ? `${r.sleep.summary.atFloor} of ${r.sleep.summary.nights} nights at 7 h` : "Log nights on Sleep"} />
        <Stat label="Habits kept" value={r.habits.due ? rateText(r.habits.kept, r.habits.due) : "—"} sub={r.habits.habits.length ? `${r.habits.habits.length} habit${r.habits.habits.length === 1 ? "" : "s"}` : "Pick habits on Practices"} />
      </div>
      <p className="mb-8 text-xs text-ink-2">
        <Link href={`/body/sleep?range=${range}${from ? `&from=${from}` : ""}`} className="underline">Sleep over this range</Link> · <Link href={`/body/practices?range=${range}${from ? `&from=${from}` : ""}`} className="underline">Practices over this range</Link> · <Link href="/body/weight?range=90" className="underline">Weigh-ins</Link>
      </p>
    </>
  );
}

export default async function BodyWeekPage({ searchParams }: { searchParams: Promise<{ week?: string; range?: string; from?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  if (isRangeKey(sp.range) && sp.range !== "week") return <RangeView v={v} range={sp.range} from={sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null} />;
  const asked = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? startOfWeek(sp.week) : startOfWeek(v.today);
  const monday = asked > startOfWeek(v.today) ? startOfWeek(v.today) : asked;
  const w = await bodyWeek(v.workspace.id, v.user.id, monday, v.today);
  if (!w) redirect("/body");
  const unit = w.settings.weightUnit;
  const n = w.nutrition;
  const pn = w.prevNutrition;
  const label = w.isCurrent ? "This week" : `Week of ${formatDate(monday, { month: "short", day: "numeric" })}`;

  return (
    <>
      <HumanosHeader
        title={label}
        subtitle={`${formatDate(monday, { weekday: "short", month: "short", day: "numeric" })} to ${formatDate(w.sunday, { weekday: "short", month: "short", day: "numeric" })}. Averages over the days with something logged.`}
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href="/body/insights" className="text-xs text-ink-2 hover:underline" data-testid="week-insights-link">
              Patterns →
            </Link>
            <Link href={`/body/week?week=${addDays(monday, -7)}`} className="btn btn-ghost btn-sm" aria-label="Previous week">
              ←
            </Link>
            <span className="font-medium" data-testid="week-label">
              {label}
            </span>
            <Link href={`/body/week?week=${addDays(monday, 7)}`} className={`btn btn-ghost btn-sm ${w.isCurrent ? "pointer-events-none opacity-40" : ""}`} aria-label="Next week">
              →
            </Link>
          </div>
        }
      />

      <RangePicker path="/body/week" bounds={rangeBounds("week", monday, v.today, { addDays, startOfWeek })} today={v.today} />
      {/* Rev 237 phase 15: the week in a paragraph, only with the member's AI switch on (the action says so otherwise). */}
      {w.settings.aiUse ? <WeekSummary action={summariseWeekAction} monday={monday} /> : null}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Nutrition</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="week-nutrition" data-logged={n.daysLogged} data-in-band={n.daysInBand} data-judged={n.daysJudged}>
        <Stat label="Days logged" value={`${n.daysLogged} of ${n.daysPassed}`} sub={n.daysJudged ? <span data-testid="week-in-band">{n.daysInBand} of {n.daysJudged} finished days in band {MARK_ICON.in}</span> : "In band once a day with targets finishes"} />
        <Stat label="Calories a day" value={n.avgCal != null ? fmtMacro("cal", n.avgCal) : "—"} sub={<Delta value={n.avgCal != null && pn.avgCal != null ? Math.round(n.avgCal - pn.avgCal) : null} better={undefined} />} />
        <Stat label="Protein a day" value={n.avgP != null ? `${fmtMacro("p", n.avgP)} g` : "—"} sub={n.avgPFloor != null ? <span className={n.avgP != null && n.avgP < n.avgPFloor ? "text-warn" : "text-good"}>floor {fmtMacro("p", n.avgPFloor)} g{n.avgP != null ? (n.avgP >= n.avgPFloor ? " · met" : " · under") : ""}</span> : <Delta value={n.avgP != null && pn.avgP != null ? n.avgP - pn.avgP : null} unit=" g" better="up" />} />
        <Stat label="Fat a day" value={n.avgF != null ? `${fmtMacro("f", n.avgF)} g` : "—"} sub={n.avgFCeiling != null ? <span className={n.avgF != null && n.avgF > n.avgFCeiling ? "text-warn" : "text-good"}>ceiling {fmtMacro("f", n.avgFCeiling)} g{n.avgF != null ? (n.avgF <= n.avgFCeiling ? " · under" : " · over") : ""}</span> : <Delta value={n.avgF != null && pn.avgF != null ? n.avgF - pn.avgF : null} unit=" g" better="down" />} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Training</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="week-training" data-sessions={w.training.sessions} data-planned={w.training.planned ?? ""} data-sets={w.training.sets} data-prs={w.training.prs}>
        <Stat label="Sessions" value={w.training.planned != null ? `${w.training.sessions} of ${w.training.planned}` : String(w.training.sessions)} sub={<Delta value={w.training.sessions - w.prevTraining.sessions} better="up" />} />
        <Stat label="Sets" value={String(w.training.sets)} sub={<Delta value={w.training.sets - w.prevTraining.sets} better="up" />} />
        <Stat label="PRs" value={String(w.training.prs)} sub={w.training.prs ? "🏆" : "A set that beats everything before it"} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Weight</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="week-weight" data-avg={w.weigh.avg ?? ""} data-days={w.weigh.days}>
        <Stat label="Average" value={w.weigh.avg != null ? fmtMetric("weight", w.weigh.avg, unit) : "—"} sub={w.weigh.avg != null ? <span>{w.weigh.days} weigh-in{w.weigh.days === 1 ? "" : "s"} · <Delta value={w.weigh.change != null ? (unit === "kg" ? Math.round((w.weigh.change / 2.20462) * 10) / 10 : w.weigh.change) : null} unit={` ${unit}`} better={w.pace ? (w.pace.toGo < 0 ? "down" : "up") : undefined} /></span> : "No weigh-ins this week"} />
        {w.pace ? (
          <Stat
            label="Goal pace"
            value={<span className={w.pace.onPace == null ? "" : w.pace.onPace ? "text-good" : "text-warn"} data-testid="week-pace" data-on={w.pace.onPace == null ? "" : w.pace.onPace ? "1" : "0"}>{w.pace.onPace == null ? "—" : w.pace.onPace ? "On pace" : "Behind"}</span>}
            sub={
              <span>
                {fmtMetric("weight", Math.abs(w.pace.toGo), unit)} to go to {fmtMetric("weight", w.pace.target, unit)}
                {w.pace.by ? ` by ${formatDate(w.pace.by)}` : ""}
                {w.pace.needPerWeek != null ? ` · needs ${fmtMetric("weight", Math.abs(w.pace.needPerWeek), unit)} a week` : ""}
                {w.pace.actualPerWeek != null ? ` · doing ${w.pace.actualPerWeek > 0 ? "+" : w.pace.actualPerWeek < 0 ? "−" : ""}${fmtMetric("weight", Math.abs(w.pace.actualPerWeek), unit)} a week` : ""}
              </span>
            }
          />
        ) : null}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">Sleep and practices</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="week-recovery" data-sleep-avg={w.sleep.avg ?? ""} data-sleep-nights={w.sleep.nights} data-habits-kept={w.habits.kept} data-habits-due={w.habits.due}>
        <Stat label="Sleep a night" value={w.sleep.avg != null ? fmtHours(w.sleep.avg) : "—"} sub={w.sleep.avg != null ? <span>{w.sleep.atFloor} of {w.sleep.nights} at 7 h · <Delta value={w.sleep.change} unit=" h" better="up" /></span> : "Log nights on Sleep"} />
        <Stat label="Habits kept" value={w.habits.due ? `${w.habits.kept} of ${w.habits.due}` : "—"} sub={w.habits.due ? <Delta value={w.habits.prevDue ? Math.round((w.habits.kept / w.habits.due) * 100) - Math.round((w.habits.prevKept / w.habits.prevDue) * 100) : null} unit="%" better="up" /> : "Pick habits on Practices"} />
      </div>

      <Card title="The days">
        <ul className="divide-y text-sm" data-testid="week-days">
          {w.days.map((d) => (
            <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="week-day" data-date={d.date}>
              <Link href={`/body?date=${d.date}`} className="hover:underline">
                {formatDate(d.date, { weekday: "short", month: "short", day: "numeric" })} <span className="text-xs text-ink-3">{d.dayType ?? ""}</span>
                {d.flag && isDayFlag(d.flag) ? <span className="ml-1" title={d.flag} data-testid="week-day-flag">{FLAG_ICON[d.flag]}</span> : null}
              </Link>
              <span className="tabular text-xs text-ink-2">{d.logged ? `${fmtMacro("cal", d.totals.cal)} cal · ${fmtMacro("p", d.totals.p)} P · ${fmtMacro("f", d.totals.f)} F${d.worst ? ` ${MARK_ICON[d.worst]}` : ""}` : "—"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-3">Off-plan meals join this page when they arrive.</p>
      </Card>
    </>
  );
}
