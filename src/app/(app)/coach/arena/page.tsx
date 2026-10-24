import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, Empty, PageHeader } from "@/components/ui";
import { arenaFor, arenaRoster, huddleAttendance, huddlesFor, placePods, podsFor } from "@/lib/arena";
import { captainAction, movePodAction, newPodAction } from "@/lib/actions/arena";
import { SubmitButton } from "@/components/submit-button";
import { huddleWhen } from "@/lib/engine/arena";
import { ARENA, ARENA_DAYS, arenaDay, arenaPhase, dateIn, rankEntries } from "@/lib/engine/arena";
import { stampDate } from "@/lib/dates";

export const metadata = { title: "30 Days in the Arena: who's in" };

/**
 * The coach's Arena (H-1563 PR A): who is in, their days closed out of 24, their points inside the window and their calls
 * booked, best first by the page's own rule. A finisher is marked once they reach 24. PR B adds the pods (filled in join
 * order, five to a pod; the coach moves members and names captains) and Huddle attendance. Names are on this page for the
 * coach only, never in a log.
 */
const POD_NOTES: Record<string, string> = { moved: "Moved.", captain: "Captain named.", new: "A new pod is ready. Move members into it." };

export default async function CoachArenaPage({ searchParams }: { searchParams: Promise<{ pods?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const c = await arenaFor(v.workspace.id);
  await placePods(c.id, v.workspace.id);
  const roster = await arenaRoster(v.workspace.id, c);
  const rows = rankEntries(roster);
  const [pods, huddles, attendance] = await Promise.all([podsFor(v.workspace.id, c, roster), huddlesFor(c), huddleAttendance(c)]);
  const podName = new Map(pods.map((p) => [p.id, p.name]));
  const podNote = sp.pods ? (POD_NOTES[sp.pods] ?? sp.pods) : null;
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
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] text-sm" data-testid="coach-arena-table">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Level</th>
                <th className="py-2 pr-3 text-right font-medium">Days closed</th>
                <th className="py-2 pr-3 text-right font-medium">Points</th>
                <th className="py-2 pr-3 text-right font-medium">Calls booked</th>
                <th className="py-2 pr-3 font-medium">Pod</th>
                <th className="py-2 pr-3 text-right font-medium">Huddles</th>
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
                  <td className="py-2 pr-3 text-ink-2">{r.podId ? (podName.get(r.podId) ?? "") : ""}</td>
                  <td className="py-2 pr-3 text-right tabular" data-testid="coach-arena-huddles">{attendance.byMember.get(r.membershipId) ?? 0}</td>
                  <td className="py-2 text-ink-3">{stampDate(r.joinedAt, v.tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <Empty icon="🏛️" title="Nobody is in yet" hint="Members tap I'm in on the Arena page or on their Today card." />
        )}
        <p className="mt-3 text-xs text-ink-3">
          Points count from midnight Pacific on Fri 27 Nov to the end of Sat 26 Dec, from the same sources as always. Ties go to more days closed, then more calls booked.
        </p>
      </Card>

      <div id="pods" className="mt-4">
        <Card
          title="Pods"
          action={
            <form action={newPodAction}>
              <SubmitButton className="btn btn-ghost btn-sm min-h-11!" pendingText="Adding…" data-testid="coach-arena-newpod">
                New pod
              </SubmitButton>
            </form>
          }
        >
          {podNote ? (
            <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm" data-testid="coach-arena-pods-note">
              {podNote}
            </p>
          ) : null}
          {pods.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {pods.map((p) => (
                <div key={p.id} className="rounded-lg border p-3" data-testid="coach-arena-pod" data-pod={p.name}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    <span className="text-xs text-ink-3">{p.members.length} of 5</span>
                  </div>
                  {p.members.length ? (
                    <ul className="mt-2 divide-y">
                      {p.members.map((m) => (
                        <li key={m.membershipId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="coach-arena-pod-member" data-captain={m.captain ? "1" : undefined}>
                          <span className="min-w-0 flex-1">
                            {m.name}
                            {m.captain ? <span className="ml-2 text-xs font-semibold text-accent">Captain</span> : null}
                            <span className="block text-xs text-ink-3">
                              {m.daysClosed} of {c.targetDays} days{m.lastClose ? ` · last close ${stampDate(m.lastClose, v.tz)}` : ""}
                            </span>
                          </span>
                          {!m.captain ? (
                            <form action={captainAction}>
                              <input type="hidden" name="podId" value={p.id} />
                              <input type="hidden" name="membershipId" value={m.membershipId} />
                              <SubmitButton className="btn btn-ghost btn-sm min-h-11!" pendingText="…" data-testid="coach-arena-captain">
                                Make captain
                              </SubmitButton>
                            </form>
                          ) : null}
                          {pods.length > 1 ? (
                            <form action={movePodAction} className="flex items-center gap-1">
                              <input type="hidden" name="membershipId" value={m.membershipId} />
                              <label className="sr-only" htmlFor={`move-${m.membershipId}`}>
                                Move {m.name} to
                              </label>
                              <select id={`move-${m.membershipId}`} name="podId" defaultValue={p.id} className="field min-h-11 w-auto! py-1" data-testid="coach-arena-move-to">
                                {pods.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton className="btn btn-ghost btn-sm min-h-11!" pendingText="…" data-testid="coach-arena-move">
                                Move
                              </SubmitButton>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink-3">Empty. Move members in from another pod.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="👥" title="No pods yet" hint="Members go into pods of five, in the order they join." />
          )}
          <p className="mt-3 text-xs text-ink-3">New members fill the first pod with room. A captain sees their pod&apos;s days closed and last close on the Arena page.</p>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Huddles">
          <ul className="divide-y text-sm" data-testid="coach-arena-huddle-list">
            {huddles.map((h) => (
              <li key={h.id} className="flex items-baseline justify-between gap-3 py-2" data-testid="coach-arena-huddle">
                <span>
                  {huddleWhen(h.startsAt)}
                  <span className="block text-xs text-ink-3">{h.label}</span>
                </span>
                <span className="tabular">{attendance.byHuddle.get(h.id) ?? 0} checked in</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Members tap I&apos;m here on the Arena page from 30 minutes before to 90 minutes after each Huddle starts, once each, for 10 points.</p>
        </Card>
      </div>
    </>
  );
}
