import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, Empty, PageHeader } from "@/components/ui";
import { arenaFor, arenaRoster } from "@/lib/arena";
import { ARENA, ARENA_DAYS, arenaDay, arenaPhase, dateIn, rankEntries } from "@/lib/engine/arena";
import { stampDate } from "@/lib/dates";

export const metadata = { title: "30 Days in the Arena: who's in" };

/**
 * The coach's Arena (H-1563 PR A): who is in, their days closed out of 24, their points inside the window and their calls
 * booked, best first by the page's own rule. A finisher is marked once they reach 24. Pods, captains and Huddle attendance
 * arrive in PR B. Names are on this page for the coach only, never in a log.
 */
export default async function CoachArenaPage() {
  const v = await requireCoach();
  const c = await arenaFor(v.workspace.id);
  const rows = rankEntries(await arenaRoster(v.workspace.id, c));
  const today = dateIn(ARENA.timezone, new Date());
  const phase = arenaPhase(c, today);
  const day = arenaDay(c, today);
  const finished = rows.filter((r) => r.daysClosed >= c.targetDays).length;
  const where = phase === "before" ? `Opens Fri 27 Nov. Joining is open until Thu 26 Nov.` : phase === "open" ? `Day ${day} of ${ARENA_DAYS}.` : "The Arena has closed.";
  return (
    <>
      <PageHeader
        title="30 Days in the Arena"
        subtitle={`${where} ${rows.length} in, ${finished} at ${c.targetDays} days.`}
        action={
          <Link href="/arena" className="btn btn-ghost btn-sm">
            The page
          </Link>
        }
      />
      <Card title="Who's in">
        {rows.length ? (
          <table className="w-full text-sm" data-testid="coach-arena-table">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Level</th>
                <th className="py-2 pr-3 text-right font-medium">Days closed</th>
                <th className="py-2 pr-3 text-right font-medium">Points</th>
                <th className="py-2 pr-3 text-right font-medium">Calls booked</th>
                <th className="py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.membershipId} data-testid="coach-arena-row" data-days={r.daysClosed} data-points={r.points}>
                  <td className="py-2 pr-3">
                    <Link href={`/coach/${r.membershipId}`} className="hover:underline">
                      {r.name}
                    </Link>
                    {r.daysClosed >= c.targetDays ? <span className="ml-2 text-xs text-good">finished</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{r.level}</td>
                  <td className="py-2 pr-3 text-right tabular">
                    {r.daysClosed} of {c.targetDays}
                  </td>
                  <td className="py-2 pr-3 text-right tabular">{r.points.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right tabular">{r.callsBooked}</td>
                  <td className="py-2 text-ink-3">{stampDate(r.joinedAt, v.tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon="🏛️" title="Nobody is in yet" hint="Members tap I'm in on the Arena page or on their Today card." />
        )}
        <p className="mt-3 text-xs text-ink-3">
          Points count from midnight Pacific on Fri 27 Nov to the end of Sat 26 Dec, from the same sources as always. Ties go to more days closed, then more calls booked.
        </p>
      </Card>
    </>
  );
}
