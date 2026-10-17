import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { SubmitButton } from "@/components/submit-button";
import { runDeskCheckAction, saveDeskAccessAction, setMovesPausedAction } from "@/lib/actions/leaderboard";
import { type BoardRow, fmt } from "@/lib/engine/leaderboard";
import { memberRef } from "@/lib/engine/points-outbox";
import { allPaused } from "@/lib/points-outbox";

/**
 * The Points desk's settings on the client's /coach row (H-493), the coach's only: who on the client's team may use the desk
 * (the community manager, H-429), the pause, and the one add-and-deduct check on a test pass from the hide list that opens it.
 */
export async function DeskSettings({ feed }: { feed: schema.LeaderboardFeed }) {
  const team = await db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.ownerMembershipId, feed.membershipId), isNull(schema.teamMembers.removedAt)) });
  const people = team.length ? await db.query.users.findMany({ where: inArray(schema.users.id, team.map((t) => t.teamUserId)) }) : [];
  let rows: BoardRow[] = [];
  try {
    rows = feed.cacheJson ? (JSON.parse(feed.cacheJson) as BoardRow[]) : [];
  } catch {
    rows = [];
  }
  const tests = rows.filter((r) => feed.hidden.includes(r.id));
  return (
    <details className="basis-full mt-1" id={`desk-${feed.id}`} data-testid="desk-settings" open={feed.deskCheckOk === false || undefined}>
      <summary className="cursor-pointer text-ink-3">Points desk{feed.deskCheckOk ? " · open" : " · closed until the check passes"}{feed.movesPaused || allPaused() ? " · paused" : ""}</summary>
      <p className="mt-1 text-[11px] text-ink-3">On their /loyalty page, for you while working in their HelixOS and for the team members you tick here. Every move is an add or a deduct by customer id through the outbox, once, with its reason.</p>

      <form action={saveDeskAccessAction} className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <input type="hidden" name="id" value={feed.id} />
        {people.length ? (
          people.map((u) => (
            <label key={u.id}>
              <input type="checkbox" name="deskUser" value={u.id} defaultChecked={feed.deskUserIds.includes(u.id)} data-testid="desk-user" /> {u.name}
            </label>
          ))
        ) : (
          <span className="text-ink-3">No one is on their team yet. Invite the community manager from their Settings → Team first.</span>
        )}
        {people.length ? (
          <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="desk-users-save">
            Save who can use it
          </SubmitButton>
        ) : null}
      </form>

      <form action={setMovesPausedAction} className="mt-2 flex items-center gap-2 text-xs">
        <input type="hidden" name="id" value={feed.id} />
        <label>
          <input type="checkbox" name="paused" defaultChecked={feed.movesPaused} data-testid="desk-pause" /> Pause every move (they wait, nothing is sent)
        </label>
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="desk-pause-save">
          Save
        </SubmitButton>
        {allPaused() ? <span className="text-warn">Paused for every program in the environment.</span> : null}
      </form>

      <form action={runDeskCheckAction} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="id" value={feed.id} />
        <select className="field max-w-xs" name="member" required defaultValue="" data-testid="desk-check-pass">
          <option value="" disabled>
            A test pass from the hide list
          </option>
          {tests.map((r) => (
            <option key={memberRef(feed.id, r.id)} value={memberRef(feed.id, r.id)}>
              {r.name} · {fmt(r.available)} available
            </option>
          ))}
        </select>
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…" data-testid="desk-check-run" disabled={!tests.length}>
          Check add and deduct (1 off, 1 back)
        </SubmitButton>
      </form>
      {!tests.length ? <p className="mt-1 text-[11px] text-ink-3">Put a team test pass on the hide list first: the check never runs on a member.</p> : null}
      {feed.deskCheckAt ? (
        <p className={`mt-1 text-xs ${feed.deskCheckOk ? "" : "text-danger"}`} data-testid="desk-check-note">
          {feed.deskCheckNote}
        </p>
      ) : null}
    </details>
  );
}
