import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { DualLine, Scatter } from "@/components/body/pair-charts";
import { LAGS, PRESETS, R_THRESHOLD, WINDOWS, type Grain } from "@/lib/engine/body-correlate";
import { bodySettingsFor, correlate, insightMetrics, requireBodyEnabled } from "@/lib/queries/body";

export const metadata = { title: "HumanOS · Patterns" };

type Sp = { a?: string; b?: string; lag?: string; window?: string; grain?: string; injury?: string };

/**
 * The correlation explorer (B10, revs 196, 198, 231): any two tracked metrics on one timeline with an honest readout. Plain
 * statistics in the app, no AI. Pearson r always with n, nothing under 21 pairs, an early signal to 41, a pattern named only
 * when it holds in both halves and clears the threshold, and always "moved together", never "caused". Private like the rest of
 * Body; the business side is the member's own daily log.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const metrics = await insightMetrics(v.workspace.id, v.user.id);
  const known = (k: string | undefined) => (k && metrics.some((m) => m.key === k) ? k : null);
  const a = known(sp.a) ?? PRESETS[0].a;
  const b = known(sp.b) ?? PRESETS[0].b;
  const A = metrics.find((m) => m.key === a)!;
  const B = metrics.find((m) => m.key === b)!;
  const lag = (LAGS as readonly number[]).includes(Number(sp.lag)) ? Number(sp.lag) : sp.lag == null ? PRESETS[0].lag : 0;
  const window = (WINDOWS as readonly number[]).includes(Number(sp.window)) ? Number(sp.window) : 8;
  // Weight and body fat % read weekly unless asked otherwise (rev 231).
  const grain: Grain = sp.grain === "daily" || sp.grain === "weekly" ? sp.grain : A.weeklyByDefault || B.weeklyByDefault ? "weekly" : "daily";
  const injury = sp.injury === "1";
  const r = await correlate(v.workspace.id, v.user.id, v.today, v.tz, { a, b, lag, window, grain, excludeFlagged: injury });
  if (!r) redirect("/body/insights");
  const groups = [...new Set(metrics.map((m) => m.group))];
  const q = (p: Record<string, string | number | boolean>) => `/body/insights?${new URLSearchParams(Object.entries({ a, b, lag, window, grain, injury: injury ? "1" : "0", ...p }).map(([k, val]) => [k, String(val)])).toString()}`;

  return (
    <>
      <HumanosHeader
        title="Patterns"
        subtitle="Any two of your numbers on one timeline, with an honest readout: how they moved together, over how many days. Never a cause."
        action={
          <Link href="/body/week" className="btn btn-ghost btn-sm">
            ← This week
          </Link>
        }
      />

      <Card className="mb-4" title="Pick two">
        <form method="get" className="grid gap-3 sm:grid-cols-2" data-testid="insights-form">
          <label className="block">
            <span className="label">A</span>
            <select name="a" className="field" defaultValue={a} data-testid="insights-a">
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {metrics
                    .filter((m) => m.group === g)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">B</span>
            <select name="b" className="field" defaultValue={b} data-testid="insights-b">
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {metrics
                    .filter((m) => m.group === g)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">B read how many days after A</span>
            <select name="lag" className="field" defaultValue={lag} data-testid="insights-lag">
              {LAGS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "the same day" : n === 1 ? "the next day" : `${n} days later`}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Window and grain</span>
            <span className="flex gap-2">
              <select name="window" className="field" defaultValue={window} data-testid="insights-window">
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
              <select name="grain" className="field" defaultValue={grain} data-testid="insights-grain">
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
              </select>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="injury" value="1" defaultChecked={injury} /> Leave out days with an open injury
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-humanos btn-sm" data-testid="insights-go">
              Look
            </button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2" data-testid="insights-presets">
          {PRESETS.filter((p) => metrics.some((m) => m.key === p.a) && metrics.some((m) => m.key === p.b)).map((p) => (
            <Link key={p.label} href={q({ a: p.a, b: p.b, lag: p.lag, grain: p.grain })} className="btn btn-soft btn-xs">
              {p.label}
            </Link>
          ))}
        </div>
      </Card>

      <Card className="mb-4" title={`${A.label} and ${B.label}`}>
        <p className={`text-sm ${r.verdict.kind === "steady" ? "font-medium" : "text-ink-2"}`} data-testid="insights-verdict" data-kind={r.verdict.kind} data-r={r.verdict.r ?? ""} data-n={r.verdict.n}>
          {r.verdict.words}
        </p>
        <p className="mt-1 text-[11px] text-ink-3">
          {grain === "weekly" ? "Weekly: counts add up, levels average, by week." : `Daily: ${lag ? `${B.label} is read ${lag} day${lag === 1 ? "" : "s"} after ${A.label}.` : "both on the same day."}`} {r.excluded ? `${r.excluded} day${r.excluded === 1 ? "" : "s"} with an open injury left out.` : ""} A pattern is named only when r is at least {R_THRESHOLD} and keeps its sign in both halves of the range. Moving together is not a cause.
        </p>
        <div className="mt-3">
          <DualLine a={r.seriesA} b={r.seriesB} labelA={A.label} labelB={B.label} from={r.from} to={r.to} />
        </div>
      </Card>

      {r.verdict.kind !== "none" ? (
        <Card className="mb-8" title="Each pair">
          <Scatter pairs={r.pairs} labelA={A.label} labelB={B.label} />
        </Card>
      ) : null}
    </>
  );
}
