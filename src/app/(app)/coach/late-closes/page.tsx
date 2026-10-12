import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { LATE_CLOSE_UNTIL_HOUR } from "@/lib/engine/streak";
import { lateCountsLine } from "@/lib/engine/late-close";
import { lateCloseDryRun } from "@/lib/late-close";

export const metadata = { title: "Late close-outs" };

/**
 * Late close-outs, the dry run (rev 731, Danno's answers at rev 746). Coach only, counts only, never a name: the closes made
 * between midnight and 04:00 that landed on the new day, and what crediting them to the day before would do. Nothing on this
 * page changes anything; the apply comes after Danno says go.
 */
export default async function LateClosesPage() {
  const v = await requireCoach();
  const { counts: c } = await lateCloseDryRun(v.workspace.id, v.workspace.timezone);
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
    </>
  );
}
