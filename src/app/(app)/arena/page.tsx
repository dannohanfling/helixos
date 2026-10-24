/**
 * 30 Days in the Arena (H-1562, plan H-1563, v3 brief H-1575): the page Danno approved, ported with its copy and look kept and
 * its CSS scoped to this page (arena.css). Every join button is "I'm in", which enrolls the signed-in member once; after that it
 * says "You're in". Members at the Arena's levels and the coach see it; a team member reads it as not found.
 */
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { arenaBoard, arenaFor, arenaRoster, entryFor, huddlesFor, myHuddles, placePods, podsFor } from "@/lib/arena";
import { blockedFor } from "@/lib/blocks";
import { ArenaHuddleCheckin, ArenaLeaderboard, ArenaPod } from "@/components/arena-board";
import { joinArenaAction } from "@/lib/actions/arena";
import { ArenaCountdown } from "@/components/arena-countdown";
import { SubmitButton } from "@/components/submit-button";
import { ARENA, arenaPhase, canEnter, canSee, countdownNow, dateIn, huddleLive, joinOpen, nextHuddle } from "@/lib/engine/arena";
import { arenaDisplay } from "./fonts";
import "./arena.css";

export const metadata = { title: "30 Days in the Arena" };

/** The page's example meter: 24 of 30 days closed, day 27 the one that completes it. */
const METER = Array.from({ length: 30 }, (_, i) => i + 1);
const CLOSED_EXAMPLE = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27];

const NOTES: Record<string, string> = {
  in: "You're in. Your challenge card is on your Today page.",
  closed: "Joining closed on Thursday 26 November.",
  "not-yours": "The Arena is for Accelerator, Academy and Elite members.",
};

export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ arena?: string; huddle?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const who = { role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) };
  if (!canSee(who)) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center" data-testid="arena-not-yours">
        <h1 className="text-lg font-semibold">30 Days in the Arena</h1>
        <p className="mt-2 text-sm text-ink-2">The Arena is for Accelerator, Academy and Elite members.</p>
      </div>
    );
  }
  const c = await arenaFor(v.workspace.id);
  let entry = v.role === "client" ? await entryFor(c.id, v.membership.id) : undefined;
  // PR A's entries had no pod: placing them is once, on the first read after PR B.
  if (entry && !entry.podId) {
    await placePods(c.id, v.workspace.id);
    entry = await entryFor(c.id, v.membership.id);
  }
  const now = new Date();
  const today = dateIn(ARENA.timezone, now);
  const open = joinOpen(c, today);
  const phase = arenaPhase(c, today);
  const [roster, blocks, huddles] = await Promise.all([arenaRoster(v.workspace.id, c), blockedFor(v), huddlesFor(c)]);
  const [board, pods, mine] = await Promise.all([
    arenaBoard(v, c, blocks, { today, roster }),
    entry?.podId ? podsFor(v.workspace.id, c, roster) : Promise.resolve([]),
    entry ? myHuddles(c, v.membership.id) : Promise.resolve(new Set<string>()),
  ]);
  const myPod = entry?.podId ? (pods.find((p) => p.id === entry!.podId) ?? null) : null;
  const live = huddleLive(now, huddles);
  const comingHuddle = nextHuddle(now, huddles);
  const note = sp.arena ? (NOTES[sp.arena] ?? null) : null;
  const join =
    v.role === "coach" ? (
      <Link className="ar-btn ar-btn-gold" href="/coach/arena">
        Who&apos;s in
      </Link>
    ) : entry ? (
      <span className="ar-btn ar-btn-gold" aria-disabled="true" data-testid="arena-in">
        You&apos;re in
      </span>
    ) : open && canEnter(who) ? (
      <form action={joinArenaAction}>
        <SubmitButton className="ar-btn ar-btn-gold" pendingText="Joining…" data-testid="arena-join">
          I&apos;m in
        </SubmitButton>
      </form>
    ) : (
      <span className="ar-btn ar-btn-ghost" aria-disabled="true" data-testid="arena-join-closed">
        Joining closed 26 Nov
      </span>
    );
  return (
    <div className={`ar ${arenaDisplay.variable}`} data-testid="arena-page">
      <nav className="ar-nav"><div className="ar-wrap">
        <div className="ar-brand">30 Days in the <span>Arena</span></div>
        {join}
      </div></nav>


      <header className="ar-hero">
        <div className="ar-arches"></div>
        <div className="ar-wrap">
          {note ? <p className="ar-note" data-testid="arena-note">{note}</p> : null}
          <div className="ar-dates">Evolve Omega members · <b>Fri 27 Nov to Sat 26 Dec</b></div>
          <h1><span className="ar-num">Thirty Days in the</span><span className="ar-gold">Arena</span></h1>
          <p className="ar-sub">I&apos;m going to Egypt for a month. You&apos;re coming with me. Not on the plane. In the arena.</p>
          <div className="ar-ctas">
            {join}
            <a className="ar-btn ar-btn-ghost" href="#how">How it works</a>
          </div>
          {v.role === "coach" ? <Link className="ar-coach" href="/coach/arena" data-testid="arena-coach-link">Who&apos;s in: the coach&apos;s view</Link> : null}
          <ArenaCountdown initial={countdownNow()} />
        </div>
      </header>
      <div className="ar-key"></div>

      <ArenaLeaderboard board={board} phase={phase} />


      <section id="how"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">How it works</span>
          <h2>Show up 24 days. <span className="ar-gold">That&apos;s the challenge.</span></h2>
          <p className="ar-sub">December is the month most people drift. We&apos;re not going to drift. Small daily wins, done together.</p>
        </div>
        <div className="ar-steps">
          <div className="ar-card ar-step">
            <div className="ar-n">1</div>
            <h3>Join by 26 Nov</h3>
            <p>Tap <b>I&apos;m in</b> on your Today page in HelixOS. You&apos;ll get a pod, a captain and your challenge card.</p>
          </div>
          <div className="ar-card ar-step">
            <div className="ar-n">2</div>
            <h3>Close your day</h3>
            <div className="ar-big">24 of 30</div>
            <p>Close out your day in HelixOS on at least 24 of the 30 days. Six days of slack for the holidays and life.</p>
          </div>
          <div className="ar-card ar-step">
            <div className="ar-n">3</div>
            <h3>Stack points</h3>
            <p>Every action you take in HelixOS earns points. The member with the most points wins the grand prize.</p>
          </div>
        </div>

        <div className="ar-card ar-meter" aria-label="Example: 24 of 30 days closed">
          <div className="ar-meter-top"><b>Your 30 days</b><span>Close 24 and you&apos;ve earned your free month</span></div>
          <div className="ar-days">
            {METER.map((d) => (
              <i key={d} className={`${CLOSED_EXAMPLE.includes(d) ? "on" : ""}${d === 27 ? " goal" : ""}`.trim() || undefined} title={`Day ${d}`} />
            ))}
          </div>
          <div className="ar-meter-key"><span>■ Day closed</span><span>◇ Day 24: you&apos;ve completed the challenge</span></div>
        </div>
      </div></section>


      <section className="ar-alt" id="prizes"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">The prizes</span>
          <h2>Everyone who finishes <span className="ar-gold">wins something.</span></h2>
          <p className="ar-sub">Every prize pays off in January, when I&apos;m back and we start the new year together.</p>
        </div>
        <div className="ar-prizes">
          <div className="ar-card ar-grand">
            <span className="ar-tag">Grand prize</span>
            <h3>I&apos;ll personally help you build your webinar.</h3>
            <p>The member with the most points gets hands-on help from me and my team to build their webinar in January, start to finish.</p>
            <ul className="ar-ticks">
              <li>Your offer, your story and your slides, built with you</li>
              <li>Your registration and follow-up set up for you</li>
              <li>Your live date picked together</li>
            </ul>
          </div>
          <div className="ar-prize-list">
            <div className="ar-card">
              <h3>Finish 24 of 30 days</h3>
              <p>A free month added to your membership at your current level. Elite members get a private strategy session with me instead.</p>
            </div>
            <div className="ar-card">
              <h3>Every Wednesday</h3>
              <p>A weekly winner, called out live on the Huddle and featured in the community.</p>
            </div>
          </div>
        </div>
      </div></section>


      <section id="points"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">How to win</span>
          <h2>Points come from <span className="ar-gold">real work.</span></h2>
          <p className="ar-sub">Everything you already do in HelixOS counts. Between 27 Nov and 26 Dec, it counts toward the arena.</p>
        </div>
        <div className="ar-points">
          <div className="ar-pt"><div className="ar-ic">🌙</div><div><b>Close your day</b><span>The habit that wins the month</span></div></div>
          <div className="ar-pt"><div className="ar-ic">🧭</div><div><b>Success Path steps</b><span>Move your business forward</span></div></div>
          <div className="ar-pt"><div className="ar-ic">📣</div><div><b>Posts shipped</b><span>Get seen</span></div></div>
          <div className="ar-pt"><div className="ar-ic">💬</div><div><b>Conversations started</b><span>Where clients come from</span></div></div>
          <div className="ar-pt"><div className="ar-ic">📅</div><div><b>Calls booked</b><span>Proof the work is paying off</span></div></div>
          <div className="ar-pt"><div className="ar-ic">🏛️</div><div><b>Show up to the Huddle</b><span>Live every Wednesday</span></div></div>
        </div>
        <p className="ar-tz">Daily caps keep it about real work, not spam. Tie-break: more days closed, then more calls booked.</p>
      </div></section>


      <section className="ar-alt" id="huddles"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">The Challenge Huddle</span>
          <h2>Live with me <span className="ar-gold">every Wednesday.</span></h2>
          <p className="ar-sub">One hour, from Egypt. The leaderboard, a lesson from the trip, and live coaching.</p>
        </div>
        <div className="ar-huddles">
          <div className="ar-card ar-hud"><div className="ar-w">Wed</div><div className="ar-d">2 Dec</div><p>Week one&apos;s winner</p></div>
          <div className="ar-card ar-hud"><div className="ar-w">Wed</div><div className="ar-d">9 Dec</div><p>Halfway check</p></div>
          <div className="ar-card ar-hud"><div className="ar-w">Wed</div><div className="ar-d">16 Dec</div><p>Push week</p></div>
          <div className="ar-card ar-hud"><div className="ar-w">Wed</div><div className="ar-d">23 Dec</div><p>The final stretch</p></div>
        </div>
        <p className="ar-tz">8 AM Pacific · 11 AM Eastern · 6 PM Cairo. Recorded for anyone who can&apos;t make it live.</p>
        {entry ? <ArenaHuddleCheckin live={live} next={comingHuddle} here={live ? mine.has(live.id) : false} note={sp.huddle ?? null} /> : null}
        <div className="ar-agenda">
          <div><b>10 min</b><span>Leaderboard and shout-outs</span></div>
          <div><b>10 min</b><span>A postcard from Egypt</span></div>
          <div><b>30 min</b><span>Hot seats: live coaching</span></div>
          <div><b>10 min</b><span>Next week&apos;s focus</span></div>
        </div>
      </div></section>


      <section id="dates"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">Key dates</span>
          <h2>Put these in <span className="ar-gold">your calendar.</span></h2>
        </div>
        <div className="ar-tl">
          <div className="ar-tl-row"><div className="ar-tl-date">Mon 23 Nov</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>Live kickoff</b><span>The rules, your pod and week one&apos;s focus. Last call before I fly.</span></div></div>
          <div className="ar-tl-row"><div className="ar-tl-date">Thu 26 Nov</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>Last day to join</b><span>Tap I&apos;m in on your Today page.</span></div></div>
          <div className="ar-tl-row ar-hl"><div className="ar-tl-date">Fri 27 Nov</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>The arena opens</b><span>Day 1 of 30. Close your day.</span></div></div>
          <div className="ar-tl-row"><div className="ar-tl-date">Every Monday</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>A new lesson</b><span>Visibility, then conversations, then booking calls, then planning 2027.</span></div></div>
          <div className="ar-tl-row"><div className="ar-tl-date">Every Wednesday</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>The Challenge Huddle</b><span>Live at 8 AM Pacific.</span></div></div>
          <div className="ar-tl-row ar-hl"><div className="ar-tl-date">Sat 26 Dec</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>Day 30</b><span>The arena closes at midnight, your time.</span></div></div>
          <div className="ar-tl-row"><div className="ar-tl-date">Tue 5 Jan</div><div className="ar-tl-dot"></div><div className="ar-tl-what"><b>Winner reveal</b><span>Live, and the free months are added.</span></div></div>
        </div>
      </div></section>


      <section className="ar-alt" id="pods"><div className="ar-wrap">
        <div className="ar-center">
          <span className="ar-eyebrow">You won&apos;t do this alone</span>
          <h2>Your pod has <span className="ar-gold">your back.</span></h2>
        </div>
        <div className="ar-pods">
          <div className="ar-card">
            <h3 style={{ fontSize: "21px", marginBottom: "8px" }}>Pods of five</h3>
            <p style={{ color: "var(--ink2)" }}>You&apos;ll be in a small pod with a captain. Your captain checks in twice a week and makes sure nobody quietly drops off.</p>
          </div>
          <div className="ar-card">
            <h3 style={{ fontSize: "21px", marginBottom: "8px" }}>Help between Huddles</h3>
            <p style={{ color: "var(--ink2)" }}>Ask My Board in HelixOS for a business decision, ask the Ask Danno bot about the program, or ask your captain. Someone always answers.</p>
          </div>
        </div>
        {myPod ? <ArenaPod pod={myPod} captainView={myPod.captainMembershipId === v.membership.id} /> : null}
      </div></section>


      <section><div className="ar-wrap">
        <div className="ar-letter">
          <span className="ar-eyebrow">A note from Danno</span>
          <p>I&apos;ll be honest. Leaving for a month made me think about you.</p>
          <p>I didn&apos;t want you to feel like the room went quiet while I was gone.</p>
          <p>So I&apos;m doing the opposite. I&apos;m handing you a mission.</p>
          <p>Show up for yourself 24 days out of 30. Close your day. Take one step. Start one conversation.</p>
          <p>I&apos;ll be watching the leaderboard from Egypt, and I&apos;ll see you live every Wednesday.</p>
          <p>When I&apos;m back, we start the new year with momentum instead of catching up.</p>
          <div className="ar-sig"><div className="ar-av">D</div><div><b>Danno Hanfling</b><span>Founder, Evolve Omega</span></div></div>
        </div>
      </div></section>


      <section className="ar-alt" id="faq"><div className="ar-wrap">
        <div className="ar-center"><span className="ar-eyebrow">Questions</span><h2>Before you <span className="ar-gold">step in</span></h2></div>
        <div className="ar-faq">
          <details><summary>What does &quot;close your day&quot; mean?</summary><p>It&apos;s the evening close in HelixOS, the same one that keeps your streak going. It takes a few minutes. Close it by midnight, your time.</p></details>
          <details><summary>What if I miss a day?</summary><p>That&apos;s what the six spare days are for. Thanksgiving weekend, Christmas Eve, a sick day. You only need 24 of 30.</p></details>
          <details><summary>Do I have to be on the Wednesday Huddle?</summary><p>No. It&apos;s recorded. Showing up live earns Huddle points, so it helps if you&apos;re going for the grand prize.</p></details>
          <details><summary>How is the winner picked?</summary><p>The most points earned in HelixOS between 27 Nov and 26 Dec. If there&apos;s a tie, it goes to more days closed, then more calls booked.</p></details>
          <details><summary>When do I get my free month?</summary><p>It&apos;s added to your membership after the challenge, once the results are in. Elite members get a private strategy session with me instead.</p></details>
          <details><summary>Who answers my questions while Danno is away?</summary><p>Your captain, My Board in HelixOS, and the Ask Danno bot. And me, live every Wednesday.</p></details>
        </div>
      </div></section>


      <section className="ar-final" id="join"><div className="ar-wrap">
        <span className="ar-eyebrow">Your seat is waiting</span>
        <h2>Thirty days. <span className="ar-gold">One arena.</span></h2>
        <p className="ar-sub">Tap I&apos;m in on your Today page by Thursday 26 November. I&apos;ll see you at the kickoff on Monday the 23rd.</p>
        {join}
      </div></section>

      <footer><div className="ar-wrap">30 Days in the Arena · Evolve Omega · For members only</div></footer>
    </div>
  );
}
