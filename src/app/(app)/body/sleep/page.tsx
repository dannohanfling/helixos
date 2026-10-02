import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { TrendLine } from "@/components/body/trend-line";
import { deleteSleepAction, logSleepAction } from "@/lib/actions/body";
import { formatDate } from "@/lib/dates";
import { fmtBedtime, fmtHours, fmtMinutes, fmtWake } from "@/lib/engine/body-recovery";
import { requireBodyEnabled, sleepRange, sleepView } from "@/lib/queries/body";
import { BarChart } from "@/components/charts";
import { RangePicker } from "@/components/body/range-picker";
import { isRangeKey, rangeBounds } from "@/lib/engine/body-range";
import { addDays, startOfWeek } from "@/lib/dates";

export const metadata = { title: "HumanOS · Sleep" };

export default async function SleepPage({ searchParams }: { searchParams: Promise<{ error?: string; range?: string; from?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const s = await sleepView(v.workspace.id, v.user.id, v.today);
  if (!s) redirect("/body");
  // Longer views (phase 10b): the range's nights as a bar strip, with the average, nights under 7 h and the per-week average.
  const b = rangeBounds(isRangeKey(sp.range) ? sp.range : "month", sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null, v.today, { addDays, startOfWeek });
  const r = await sleepRange(v.workspace.id, v.user.id, b);
  const delta = s.week.avg != null && s.prevWeek.avg != null ? Math.round((s.week.avg - s.prevWeek.avg) * 10) / 10 : null;

  return (
    <>
      <HumanosHeader
        title="Sleep"
        subtitle="Last night and the week. A night belongs to the morning it ends on; 7 hours is the floor the week counts against."
        action={
          <Link href="/body/week" className="text-xs text-ink-2 hover:underline">
            This week →
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="sleep-stats" data-last={s.last?.hours ?? ""} data-avg={s.week.avg ?? ""} data-nights={s.week.nights} data-floor={s.week.atFloor}>
        <Stat label="Last night" value={s.last ? fmtHours(s.last.hours) : "—"} sub={s.last ? `${formatDate(s.last.date, { weekday: "short", month: "short", day: "numeric" })}${s.last.score != null ? ` · score ${s.last.score}` : ""}${s.last.bedtime != null && s.last.waketime != null ? ` · ${fmtBedtime(s.last.bedtime)} to ${fmtWake(s.last.waketime)}` : ""}` : "Nothing logged yet"} />
        <Stat label="This week" value={s.week.avg != null ? `${fmtHours(s.week.avg)} a night` : "—"} sub={delta != null ? <span className={`text-xs ${delta === 0 ? "text-ink-3" : delta > 0 ? "text-good" : "text-warn"}`}>{delta > 0 ? "▲ +" : delta < 0 ? "▼ −" : "= "}{Math.abs(delta)} h vs last week</span> : `${s.week.nights} night${s.week.nights === 1 ? "" : "s"} logged`} />
        <Stat label="At 7 h or more" value={s.week.nights ? `${s.week.atFloor} of ${s.week.nights}` : "—"} sub="nights this week" />
        <Stat label="Last week" value={s.prevWeek.avg != null ? `${fmtHours(s.prevWeek.avg)} a night` : "—"} sub={`${s.prevWeek.nights} night${s.prevWeek.nights === 1 ? "" : "s"}`} />
      </div>

      <Card title="Log a night" className="mb-4" id="log">
        <form action={logSleepAction} className="flex flex-wrap items-end gap-2" data-testid="sleep-form">
          <label className="w-40">
            <span className="label">Morning of</span>
            <input name="date" type="date" className="field" defaultValue={v.today} max={v.today} data-testid="sleep-date" />
          </label>
          <label className="w-28">
            <span className="label">Hours</span>
            <input name="hours" className="field tabular" required placeholder="7:30" inputMode="decimal" data-testid="sleep-hours" />
          </label>
          <label className="w-24">
            <span className="label">Score (opt.)</span>
            <input name="score" type="number" min={0} max={100} className="field tabular" placeholder="—" data-testid="sleep-score" />
          </label>
          <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid="sleep-save">
            Save
          </SubmitButton>
        </form>
        <p className="mt-2 text-[11px] text-ink-3">A night logged twice keeps the later entry. A wearable fills these in on its own once connected.</p>
      </Card>

      <Card title="Over the range" className="mb-4" id="range">
        <RangePicker path="/body/sleep" bounds={b} today={v.today} />
        <p className="mb-2 text-sm" data-testid="sleep-range" data-nights={r.summary.nights} data-avg={r.summary.avg ?? ""} data-under={r.under}>
          {r.summary.nights ? (
            <>
              <span className="font-medium">{fmtHours(r.summary.avg!)} a night</span> over {r.summary.nights} night{r.summary.nights === 1 ? "" : "s"} · {r.summary.atFloor} at 7 h or more · {r.under} under
            </>
          ) : (
            "No nights logged in this range."
          )}
        </p>
        {r.nights.length ? <BarChart data={r.nights.map((n, i, all) => ({ label: all.length > 10 && i % Math.ceil(all.length / 8) ? "" : n.date.slice(5), value: n.hours, sub: `${n.date}: ${fmtHours(n.hours)}` }))} valueLabel="hours" height={120} /> : null}
        {r.perWeek.length > 1 ? <p className="mt-2 text-xs text-ink-3">By week: {r.perWeek.map((w) => `${formatDate(w.monday, { month: "short", day: "numeric" })} ${w.value != null ? fmtHours(w.value) : "—"}`).join(" · ")}</p> : null}
      </Card>

      <Card title="30 nights" className="mb-4">
        <TrendLine points={s.trend.map((n) => ({ date: n.date, value: n.hours, label: fmtHours(n.hours) }))} unit="h" name="Hours slept" average={s.averages} goal={7} few="The chart starts with a second night." />
      </Card>

      <Card title="Recent nights" className="mb-8">
        {s.recent.length ? (
          <ul className="divide-y text-sm" data-testid="sleep-nights">
            {s.recent.map((n) => (
              <li key={n.date} className="flex items-center justify-between gap-2 py-1.5" data-testid="sleep-night" data-date={n.date}>
                <span>
                  {formatDate(n.date, { weekday: "short", month: "short", day: "numeric" })}
                  <span className="tabular text-ink-2">
                    {" "}
                    · {n.sleep_h != null ? fmtHours(n.sleep_h) : "—"}
                    {n.sleep_score != null ? ` · score ${n.sleep_score}` : ""}
                    {n.recovery != null ? ` · recovery ${n.recovery}%` : ""}
                    {n.strain != null ? ` · strain ${n.strain}` : ""}
                  </span>
                  {n.bedtime != null || n.sleep_deep_min != null ? (
                    /* Phase 16b: the window and the stages a wearable gives. */
                    <span className="block text-xs text-ink-3" data-testid="sleep-night-detail">
                      {n.bedtime != null && n.waketime != null ? `${fmtBedtime(n.bedtime)} to ${fmtWake(n.waketime)}` : ""}
                      {n.sleep_deep_min != null ? `${n.bedtime != null ? " · " : ""}deep ${fmtMinutes(n.sleep_deep_min)}` : ""}
                      {n.sleep_rem_min != null ? ` · REM ${fmtMinutes(n.sleep_rem_min)}` : ""}
                      {n.sleep_light_min != null ? ` · light ${fmtMinutes(n.sleep_light_min)}` : ""}
                      {n.sleep_awake_min != null ? ` · awake ${fmtMinutes(n.sleep_awake_min)}` : ""}
                    </span>
                  ) : null}
                </span>
                {n.sleep_h != null ? (
                  <form action={deleteSleepAction}>
                    <input type="hidden" name="date" value={n.date} />
                    <SubmitButton className="text-ink-3 hover:text-danger" pendingText="…" aria-label={`Delete the night of ${n.date}`} data-testid="sleep-delete">
                      ✕
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No nights yet.</p>
        )}
      </Card>
    </>
  );
}
