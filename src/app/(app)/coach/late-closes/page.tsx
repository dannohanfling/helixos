import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { LATE_CLOSE_UNTIL_HOUR } from "@/lib/engine/streak";
import { lateCountsLine } from "@/lib/engine/late-close";
import { lateCloseDryRun } from "@/lib/late-close";
import { recountDryRun, recountApplied } from "@/lib/streak";
import { recountLine } from "@/lib/engine/streak";
import { applyStreakRecountAction } from "@/lib/actions/streak";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Late close-outs" };

/**
 * Late close-outs, the dry run (rev 731, Danno's answers at rev 746). Coach only, counts only, never a name: the closes made
 * between midnight and 04:00 that landed on the new day, and what crediting them to the day before would do. Nothing on this
 * page changes anything; the apply comes after Danno says go.
 */
export default async function LateClosesPage({ searchParams }: { searchParams: Promise<{ applied?: string; days?: string; members?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [{ counts: c }, recount, applied] = await Promise.all([lateCloseDryRun(v.workspace.id, v.workspace.timezone), recountDryRun(v.workspace.id, v.workspace.timezone), recountApplied(v.workspace.id)]);
  const justApplied = sp.applied !== undefined ? { points: Number(sp.applied) || 0, days: Number(sp.days) || 0, members: Number(sp.members) || 0 } : null;
  const rows: [string, number, string][] = [
    ["Closes found", c.closesFound, "submitted before 4am, landed on the new day, the day before open"],
    ["Members affected", c.members, ""],
    ["Days credited", c.daysCredited, "one per close found"],
    ["Moved to the day before", c.moved, "no lock-in on the new day after it, so an evening re-close that day was the same close-out; the new day is left open"],
    ["Copied to the day before", c.copied, "the member locked in on the new day after it, so its evening close was the new day's; the new day stays closed"],
    ["Points to award", c.pointsToAward, "the credited day's close and streak bonus, never twice for a day"],
    ["Streaks that go up", c.streaksUp, "each member's running streak today"],
    ["Streaks that go down", c.streaksDown, "a moved close leaves its new day open"],
    ["Stored streak days that change", c.streakDaysChanged, "the weekly escalation in the weeks touched"],
    ["New days already paid by the late close", c.newDayAlreadyPaid, `${c.newDayPointsKept} points, kept: nothing is taken back`],
    ["Closes with a time that can't be read", c.unreadable, "left as they are"],
  ];
  return (
    <>
      <PageHeader
        title="Late close-outs"
        subtitle={`Closes made after midnight, before ${LATE_CLOSE_UNTIL_HOUR}am, that landed on the new day. This is a dry run: nothing is changed or awarded here.`}
        action={
          <Link href="/coach" className="btn btn-ghost btn-sm">
            Back
          </Link>
        }
      />
      <Card title="The dry run">
        <table className="w-full text-sm" data-testid="late-counts">
          <tbody className="divide-y">
            {rows.map(([label, n, note]) => (
              <tr key={label}>
                <td className="py-2 pr-3">{label}</td>
                <td className="py-2 pr-3 text-right font-semibold tabular" data-testid={`late-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}`}>
                  {n.toLocaleString()}
                </td>
                <td className="py-2 text-xs text-ink-3">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-ink-3">Times are read in each member&apos;s current timezone. Copy this line into the handoff doc:</p>
        <p className="mt-1 select-all rounded-lg bg-surface-2 p-2 text-sm" data-testid="late-line">
          {lateCountsLine(c)}
        </p>
      </Card>
      <Card title="Streak recount" className="mt-5">
        <p className="text-sm text-ink-2">
          The streak now counts every active day, weekends too (H-289). This dry run lists, per client, the active days up to yesterday whose bonus was never paid under the new rules, and the running streak the new rules give them today. Apply pays those days through the normal points path, &ldquo;Streak recount: date&rdquo;, one row a day: a second Apply finds every day paid and adds nothing, and nothing is ever taken back. A day you credited by hand (&ldquo;credited to {"{date}"}&rdquo; in the adjustment&apos;s reason) is that day&apos;s bonus and is skipped.
        </p>
        {justApplied ? (
          <p className="mt-3 rounded-lg bg-good-soft p-2 text-sm" data-testid="recount-applied">
            Applied: {justApplied.points.toLocaleString()} points over {justApplied.days} {justApplied.days === 1 ? "day" : "days"} to {justApplied.members} {justApplied.members === 1 ? "client" : "clients"}.
          </p>
        ) : null}
        <table className="mt-3 w-full text-sm" data-testid="recount-table">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 pr-3">Client</th>
              <th className="py-1 pr-3 text-right">Days to pay</th>
              <th className="py-1 pr-3 text-right">New streak</th>
              <th className="py-1 pr-3 text-right">Points to add</th>
              <th className="py-1 text-right">Paid by hand, skipped</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {recount.rows.map((r) => (
              <tr key={r.userId} data-testid="recount-row" data-points={r.points}>
                <td className="py-2 pr-3 font-medium">{r.initials}</td>
                <td className="py-2 pr-3 text-right tabular">
                  {r.add.length}
                  {r.add.length ? (
                    <details className="inline-block pl-2 text-xs text-ink-3">
                      <summary className="cursor-pointer">days</summary>
                      <ul className="mt-1 text-left">
                        {r.add.map((x) => (
                          <li key={x.date}>
                            {x.date} +{x.points}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular">🔥 {r.streak}</td>
                <td className="py-2 pr-3 text-right font-semibold tabular">{r.points.toLocaleString()}</td>
                <td className="py-2 text-right tabular" title={r.skipped.join(", ") || undefined}>
                  {r.skipped.length}
                </td>
              </tr>
            ))}
            {!recount.rows.length ? (
              <tr>
                <td className="py-2 text-ink-3" colSpan={5}>
                  No clients yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="text-xs text-ink-2">
            <tr>
              <td className="py-2 pr-3">{recount.totals.members} with something to pay</td>
              <td className="py-2 pr-3 text-right tabular" data-testid="recount-days">
                {recount.totals.days}
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right font-semibold tabular" data-testid="recount-points">
                {recount.totals.points.toLocaleString()}
              </td>
              <td className="py-2 text-right tabular" data-testid="recount-skipped">
                {recount.totals.skipped}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 select-all rounded-lg bg-surface-2 p-2 text-sm" data-testid="recount-line">
          {recountLine(recount)}
        </p>
        <form action={applyStreakRecountAction} className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Applying…" data-testid="recount-apply">
            {recount.totals.points ? `Apply: pay ${recount.totals.points.toLocaleString()} points` : "Apply (nothing to pay)"}
          </SubmitButton>
          <span className="text-xs text-ink-3">{applied ? "Applied before; a rerun adds nothing already paid." : "Not applied yet. Your tap is the approval."}</span>
        </form>
      </Card>
    </>
  );
}
