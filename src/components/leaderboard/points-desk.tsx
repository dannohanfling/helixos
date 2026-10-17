import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { pointsDeskMoveAction } from "@/lib/actions/leaderboard";
import { type BoardRow, fmt } from "@/lib/engine/leaderboard";
import { MAX_MOVE, memberRef } from "@/lib/engine/points-outbox";
import { newId } from "@/lib/ids";
import { recentMoves } from "@/lib/points-outbox";

const when = (iso: string) => new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const statusWords = (m: schema.LoyaltyPointsMove) => (m.status === "sent" ? "done" : m.status === "failed" ? `not moved: ${m.lastNote ?? ""}` : `waiting: ${m.lastNote ?? "queued"}`);

/**
 * The Points desk (H-493) on /loyalty: add or deduct Kindness Koins on one member's pass, with a reason, through the outbox.
 * Shown only to the two people it is for (the coach working here, and the team member the coach named); the page decides
 * that before rendering this. Members are picked from the live board by their customer id, never from a fixed list.
 */
export async function PointsDesk({ feed, unit, result, error }: { feed: schema.LeaderboardFeed; unit: string; result?: string; error?: string }) {
  let rows: BoardRow[] = [];
  try {
    rows = feed.cacheJson ? (JSON.parse(feed.cacheJson) as BoardRow[]) : [];
  } catch {
    rows = [];
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const moves = await recentMoves(feed.id, 15);
  const people = moves.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(moves.map((m) => m.byUserId))]) }) : [];
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  const done = result ? moves.find((m) => m.id === result) : undefined;
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card title="Points desk" id="desk" className="mb-4">
      <p className="text-xs text-ink-3">Add or take away {unit} on one member&apos;s pass. Every move goes to eLoyalty as an add or a deduct with your reason, once, and shows here. A deduct never takes more than they have available, and their lifetime {unit} never goes down.</p>
      {!feed.deskCheckOk ? (
        <p className="mt-2 text-sm" data-testid="desk-closed">
          The desk opens once your coach&apos;s add-and-deduct check has passed on a test pass.
        </p>
      ) : (
        <>
          {feed.movesPaused ? (
            <p className="mt-2 text-sm text-warn" data-testid="desk-paused">
              Paused by your coach: moves wait here and go to eLoyalty when the pause is lifted.
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm text-danger" data-testid="desk-error">
              {error.slice(0, 300)}
            </p>
          ) : null}
          {done ? (
            <p className={`mt-2 text-sm ${done.status === "failed" ? "text-danger" : ""}`} data-testid="desk-result">
              {done.status === "sent"
                ? `${done.delta > 0 ? "Added" : "Deducted"} ${fmt(Math.abs(done.delta))} ${unit} ${done.delta > 0 ? "to" : "from"} ${byId.get(done.customerId)?.name ?? "the member"}${done.newBalance != null ? `: ${fmt(done.newBalance)} available now` : ""}.`
                : `${byId.get(done.customerId)?.name ?? "The member"}: ${statusWords(done)}.`}
            </p>
          ) : null}
          <form action={pointsDeskMoveAction} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="nonce" value={newId()} />
            <label className="sm:col-span-2">
              <span className="label">Member</span>
              <select className="field" name="member" required defaultValue="" data-testid="desk-member">
                <option value="" disabled>
                  Choose a member
                </option>
                {sorted.map((r) => (
                  <option key={memberRef(feed.id, r.id)} value={memberRef(feed.id, r.id)}>
                    {r.name} · {fmt(r.available)} available{feed.hidden.includes(r.id) ? " (team test)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex items-center gap-4 text-sm">
              <label>
                <input type="radio" name="direction" value="add" required data-testid="desk-add" /> Add
              </label>
              <label>
                <input type="radio" name="direction" value="deduct" required data-testid="desk-deduct" /> Deduct
              </label>
            </fieldset>
            <label>
              <span className="label">{unit}</span>
              <input className="field" type="number" name="amount" min={1} max={MAX_MOVE} step={1} required data-testid="desk-amount" />
            </label>
            <label className="sm:col-span-2">
              <span className="label">Why (it goes on their history in eLoyalty)</span>
              <input className="field" name="reason" required minLength={3} maxLength={100} placeholder="Redeemed: 1-on-1 with the community manager" data-testid="desk-reason" />
            </label>
            <div className="sm:col-span-2">
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Moving…" data-testid="desk-send">
                Move the {unit}
              </SubmitButton>
            </div>
          </form>
        </>
      )}
      {moves.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs" data-testid="desk-moves">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="pr-2">When</th>
                <th className="pr-2">Member</th>
                <th className="pr-2 text-right">{unit}</th>
                <th className="pr-2">By</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className={m.status === "failed" ? "text-danger" : ""}>
                  <td className="pr-2 whitespace-nowrap">{when(m.createdAt)}</td>
                  <td className="pr-2 whitespace-nowrap">{byId.get(m.customerId)?.name ?? "a former member"}</td>
                  <td className="pr-2 text-right">{m.delta > 0 ? `+${fmt(m.delta)}` : fmt(m.delta)}</td>
                  <td className="pr-2 whitespace-nowrap">{nameOf.get(m.byUserId) ?? "—"}</td>
                  <td>{statusWords(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
