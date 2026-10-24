/**
 * 30 Days in the Arena, PR B (plan H-1563), the member's side of /arena: the leaderboard (points inside the window only, "First
 * L.", your own row marked, last week's leader at the top from Mon 30 Nov), your pod (its captain; a captain sees the pod's days
 * closed and last close) and "I'm here" at a live Huddle. Styled with the page's own arena.css.
 */
import { huddleHereAction } from "@/lib/actions/arena";
import { SubmitButton } from "@/components/submit-button";
import type { ArenaBoard, PodView } from "@/lib/arena";
import { HUDDLE_POINTS, dayWords, huddleOpensWords, huddleWhen, ordinal } from "@/lib/engine/arena";
import { shortName } from "@/lib/engine/blocks";

export function ArenaLeaderboard({ board, phase }: { board: ArenaBoard; phase: "before" | "open" | "closed" }) {
  const you = board.you;
  const youShown = you ? board.rows.some((r) => r.isYou) : false;
  return (
    <section id="board" data-testid="arena-board">
      <div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">The leaderboard</span>
          <h2>
            Points in <span className="ar-gold">the arena.</span>
          </h2>
          <p className="ar-sub">
            {phase === "before"
              ? `${board.total} ${board.total === 1 ? "member is" : "members are"} in. Points start counting on Fri 27 Nov.`
              : "Points from 27 Nov to 26 Dec only. Ties go to more days closed, then more calls booked."}
          </p>
        </div>
        {board.leader ? (
          <p className="ar-leader" data-testid="arena-leader">
            🏆 Last week&apos;s leader ({board.leader.week}): <b>{board.leader.name}</b>, {board.leader.points.toLocaleString()} points
          </p>
        ) : null}
        {board.rows.length ? (
          <ol className="ar-card ar-board">
            {board.rows.map((r) => (
              <li key={r.userId} className={r.isYou ? "ar-you" : undefined} data-testid="arena-board-row" data-you={r.isYou ? "1" : undefined}>
                <span className="ar-place">{r.place}</span>
                <span className="ar-who">
                  {r.name}
                  {r.isYou ? <em> (you)</em> : null}
                </span>
                <span className="ar-days" title="Days closed">
                  {r.daysClosed} days
                </span>
                <b className="ar-pts">{r.points.toLocaleString()}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ar-tz">Nobody is in yet. Be the first.</p>
        )}
        {you && !youShown ? (
          <p className="ar-tz" data-testid="arena-board-you">
            You&apos;re {ordinal(you.place)} of {board.total}, with {you.points.toLocaleString()} points.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function ArenaPod({ pod, captainView }: { pod: PodView; captainView: boolean }) {
  const captain = pod.members.find((m) => m.captain);
  return (
    <div className="ar-card ar-mypod" data-testid="arena-my-pod" data-captain={captainView ? "1" : undefined}>
      <h3>
        Your pod: <span className="ar-gold">{pod.name}</span>
      </h3>
      <p className="ar-mypod-line">
        {captainView
          ? `You're the captain. Check in with your pod twice a week, and reach out to anyone who hasn't closed lately.`
          : captain
            ? `Your captain is ${shortName(captain.name)}. ${pod.members.length} in your pod.`
            : `${pod.members.length} in your pod. Your captain is named before the kickoff.`}
      </p>
      {captainView ? (
        <ul className="ar-podlist">
          {pod.members.map((m) => (
            <li key={m.membershipId} data-testid="arena-pod-member">
              <span>{shortName(m.name)}</span>
              <span>{m.daysClosed} days closed</span>
              <span className="ar-last">{m.lastClose ? `Last close ${dayWords(m.lastClose)}` : "No close yet"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const HUDDLE_NOTES: Record<string, string> = {
  here: `You're checked in. +${HUDDLE_POINTS} points.`,
  already: "You're already checked in to this Huddle.",
  "not-yours": "Huddle check-ins are for members in the Arena.",
};

export function ArenaHuddleCheckin({ live, next, here, note }: { live: { id: string; startsAt: string } | null; next: { startsAt: string } | null; here: boolean; note: string | null }) {
  const said = note ? (HUDDLE_NOTES[note] ?? note) : null;
  return (
    <div className="ar-checkin" data-testid="arena-huddle">
      {said ? (
        <p className="ar-note" data-testid="arena-huddle-note">
          {said}
        </p>
      ) : null}
      {live ? (
        here ? (
          <span className="ar-btn ar-btn-gold" aria-disabled="true" data-testid="arena-huddle-in">
            You&apos;re here ✓
          </span>
        ) : (
          <form action={huddleHereAction}>
            <SubmitButton className="ar-btn ar-btn-gold" pendingText="Checking in…" data-testid="arena-huddle-here">
              I&apos;m here: +{HUDDLE_POINTS} points
            </SubmitButton>
          </form>
        )
      ) : next ? (
        <p className="ar-tz" data-testid="arena-huddle-next">
          Check in here on {huddleWhen(next.startsAt).replace(/,.*$/, "")} from {huddleOpensWords(next.startsAt)} for {HUDDLE_POINTS} points.
        </p>
      ) : null}
    </div>
  );
}
