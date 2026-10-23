/**
 * Colosseum → Challenges (H-1840, plan H-1844): the workspace's challenge in its own section, Upcoming, Active or Past, so
 * members see it coming. The words come from the challenge's row and its copy entry (src/lib/engine/arena.ts); "I'm in" is
 * the Arena page's own join, and brings the member back here. Reading this tab never writes: before anyone has opened the
 * Arena page there is no row yet, and the card reads the plan's dates instead.
 */
import Link from "next/link";
import type { Viewer } from "@/lib/auth";
import { arenaIfAny, closesFor, entryFor } from "@/lib/arena";
import { joinArenaAction } from "@/lib/actions/arena";
import { ARENA, ARENA_HUDDLES, ARENA_SLUG, canEnter, challengeView, dateIn, dayWords, huddleWhen, joinOpen, type ChallengeSection } from "@/lib/engine/arena";
import { SubmitButton } from "@/components/submit-button";

const SECTIONS: { key: ChallengeSection; title: string }[] = [
  { key: "upcoming", title: "Upcoming" },
  { key: "active", title: "Active" },
  { key: "past", title: "Past" },
];

export async function ColosseumChallenges({ v, joined }: { v: Viewer; joined: boolean }) {
  const row = await arenaIfAny(v.workspace.id);
  const c = row ?? { ...ARENA, id: null };
  const today = dateIn(c.timezone, new Date());
  const card = challengeView(c, today);
  const entry = row ? await entryFor(row.id, v.membership.id) : undefined;
  const closes = row && entry && card.section !== "upcoming" ? await closesFor(v.workspace.id, v.user.id, row, dateIn(v.tz, new Date())) : null;
  const mayJoin = canEnter({ role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) }) && !v.switchedInto && joinOpen(c, today);
  const huddles = c.slug === ARENA_SLUG ? ARENA_HUDDLES.map((h) => huddleWhen(h.startsAt)) : [];
  return (
    <section data-testid="tab-challenges-body">
      <h2 className="co-h2">Challenges</h2>
      {SECTIONS.map((s) => (
        <div key={s.key} className="co-ch-section" data-testid={`challenges-${s.key}`}>
          <p className="co-eyebrow">{s.title}</p>
          {card.section !== s.key ? (
            <p className="co-quiet">None {s.key === "past" ? "yet" : "right now"}.</p>
          ) : (
            <article className="co-ch-card" data-testid="challenge-card" data-section={card.section}>
              <div className="co-ch-head">
                <h3 className="co-ch-name">{card.name}</h3>
                <span className="co-ch-count" data-testid="challenge-countdown">{card.countdown}</span>
              </div>
              {card.promise ? <p className="co-ch-promise">{card.promise}</p> : null}
              <dl className="co-ch-facts">
                <div><dt>When</dt><dd data-testid="challenge-when">{card.when}</dd></div>
                <div><dt>To finish</dt><dd>{card.finish}</dd></div>
                {card.rewards.length ? (
                  <div>
                    <dt>Rewards</dt>
                    <dd>{card.rewards.map((r) => <span key={r} className="co-ch-line">{r}</span>)}</dd>
                  </div>
                ) : null}
                {huddles.length && card.section !== "past" ? (
                  <div><dt>Huddles</dt><dd>Wednesdays at 8 AM Pacific: {huddles.map((h) => h.split(",")[0]).join(", ")}.</dd></div>
                ) : null}
                {closes ? <div><dt>Your days</dt><dd data-testid="challenge-days">{closes.daysClosed} of {c.targetDays} closed</dd></div> : null}
              </dl>
              <div className="co-ch-actions">
                {entry ? (
                  <span className="co-btn co-on co-ch-in" data-testid="challenge-in">{joined && card.section === "upcoming" ? `You're in ✓ See you on ${dayWords(c.startDate)}.` : "You're in ✓"}</span>
                ) : mayJoin && card.section !== "past" ? (
                  <form action={joinArenaAction}>
                    <input type="hidden" name="from" value="colosseum" />
                    <SubmitButton className="co-btn co-primary" pendingText="Joining…" data-testid="challenge-join">
                      I&apos;m in
                    </SubmitButton>
                  </form>
                ) : null}
                {card.section !== "upcoming" || v.role === "coach" || entry ? (
                  <Link href="/arena" className="co-btn" data-testid="challenge-arena">
                    {card.section === "upcoming" ? "The Arena page →" : "See the leaderboard →"}
                  </Link>
                ) : null}
              </div>
            </article>
          )}
        </div>
      ))}
    </section>
  );
}
