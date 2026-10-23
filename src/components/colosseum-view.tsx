import Link from "next/link";
import type { Viewer } from "@/lib/auth";
import { arenaFor, seatsOf, shortName, standingsOf } from "@/lib/colosseum";
import { blockedFor } from "@/lib/blocks";
import { arenaLook, TAB_WORDS, TABS, TIER_RING, type Tab } from "@/lib/engine/colosseum";
import { TIERS } from "@/lib/engine/tiers";
import { ColosseumArena } from "@/components/colosseum-arena";
import { ShareWin, WinList } from "@/components/colosseum-bits";
import { ModerateMenu } from "@/components/colosseum-moderate";
import { ColosseumChallenges } from "@/components/colosseum-challenges";
import "@/components/colosseum.css";

export type ColosseumParams = { section?: string; tier?: string; kind?: string; arena?: string };

/** The Colosseum's own address (H-164 §4): the Rewards page's second tab, with its section and filters. */
export function colosseumHref(section: Tab | "arena" = "arena", extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ tab: "colosseum", ...(section === "arena" ? {} : { section }), ...extra });
  return `/rewards?${q.toString()}`;
}

/**
 * The Colosseum (rev 699, the photo arena of rev 720): one community page for a coach's workspace, where the work gets seen.
 * The arena on top, "Your seat in the stands", then the tabs: The Arena, Standings, Wins, Challenges, My week (private).
 * Off until the coach turns it on for the workspace. Light theme, typography-led, few boxes. Since H-164 §4 it is the second
 * tab of Rewards; /colosseum sends here. The caller checks the workspace's switch.
 */
export async function ColosseumView({ v, sp }: { v: Viewer; sp: ColosseumParams }) {
  const tab: Tab = (TABS as readonly string[]).includes(sp.section ?? "") ? (sp.section as Tab) : "arena";
  // The viewer's blocks and reported wins (H-745), one read for every list on the page; none while a coach is switched in.
  const a = await arenaFor(v, v.today, await blockedFor(v));
  // Block and Report are a member's own: not a coach's, and never while a coach is switched into a member.
  const moderate = v.role === "client" && !v.switchedInto && !v.team;
  // Applause (H-1171): a member or the coach in their own account; never while switched in or on a team.
  const canApplaud = !v.switchedInto && !v.team;
  // Each member's latest win for their card: the wins come newest first.
  const latestWins: Record<string, (typeof a.wins)[number]> = {};
  for (const w of a.wins) if (w.authorId && !latestWins[w.authorId]) latestWins[w.authorId] = w;
  const { rings, champs } = seatsOf(a);
  const look = arenaLook(v.membership.sceneLook, v.hour);
  // Standings filtered to a tier, or to a ring ("+N more" on the arena).
  const ringTiers = sp.tier?.startsWith("ring") ? TIERS.filter((t) => TIER_RING[t.name] === Number(sp.tier!.slice(4))).map((t) => t.name) : null;
  const tierFilter = ringTiers ? null : TIERS.some((t) => t.name === sp.tier) ? sp.tier! : null;
  const rows = ringTiers ? standingsOf(a, null).filter((r) => ringTiers.includes(r.tier)) : standingsOf(a, tierFilter);
  const kind = sp.kind === "business" || sp.kind === "community" ? sp.kind : null;
  const wins = kind ? a.wins.filter((w) => w.kind === kind) : a.wins;
  const you = a.you;
  const tabHref = (t: Tab) => colosseumHref(t);
  return (
    <div className="co-page" data-testid="colosseum">
      <header className="co-head">
        <p className="co-eyebrow">The Arena</p>
        <h1 className="co-title">The Colosseum</h1>
        <p className="co-sub">Where the work gets seen. The closer to the arena, the higher the rank.</p>
      </header>
      <ColosseumArena rings={rings} champs={champs} more={a.more} initialLook={look} initialPaused={you.paused} ownLook={!v.switchedInto} cheerWeek={v.switchedInto ? null : a.week.monday} moderate={moderate} latestWins={latestWins} canApplaud={canApplaud} />
      <section className="co-seat" aria-label="Your seat in the stands" data-testid="your-seat">
        <p className="co-eyebrow">Your seat in the stands</p>
        <p className="co-rankword">{you.tier}</p>
        <dl className="co-stats">
          <div><dt>Points</dt><dd data-testid="seat-points">{you.points.toLocaleString()}</dd></div>
          <div><dt>This week</dt><dd data-testid="seat-week">+{you.week.toLocaleString()}</dd></div>
          <div><dt>{you.nextTier ? `To ${you.nextTier}` : "Top rank"}</dt><dd data-testid="seat-next">{you.nextTier ? you.toNext.toLocaleString() : "You're there"}</dd></div>
        </dl>
        {you.hidden ? <p className="co-fine">You&apos;re hidden from the arena and the standings. <Link href="/settings#photo">Change that in Settings</Link>.</p> : null}
      </section>
      <nav className="co-tabs" aria-label="Colosseum sections">
        {TABS.map((t) => (
          <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined} className={`co-tab${tab === t ? " co-tab-on" : ""}`} data-testid={`tab-${t}`}>
            {TAB_WORDS[t]}
          </Link>
        ))}
      </nav>
      {tab === "arena" ? (
        <div className="co-zone" data-testid="tab-arena-body">
          <section>
            <h2 className="co-h2">In the arena now</h2>
            <p className="co-quiet" data-testid="no-challenge">No challenge running.</p>
            <p className="co-fine">When your coach runs one, it shows here with the days left, the community&apos;s total and yours.</p>
          </section>
          <section>
            <div className="co-row-head">
              <h2 className="co-h2">Wins from the stands</h2>
              <Link href={colosseumHref("wins")}>All wins</Link>
            </div>
            <WinList wins={a.wins.slice(0, 3)} tz={v.tz} moderate={moderate} applaud={canApplaud} />
          </section>
        </div>
      ) : null}
      {tab === "standings" ? (
        <section data-testid="tab-standings-body">
          <div className="co-row-head">
            <h2 className="co-h2">Standings</h2>
            <span className="co-quiet">Points all time · change this week</span>
          </div>
          <p className="co-filters">
            <Link href={colosseumHref("standings")} className={!tierFilter && !ringTiers ? "co-on" : ""}>All</Link>
            {TIERS.map((t) => (
              <Link key={t.name} href={colosseumHref("standings", { tier: t.name })} className={tierFilter === t.name ? "co-on" : ""}>
                {t.name}
              </Link>
            ))}
          </p>
          <ol className="co-list" data-testid="standings">
            {rows.map((r, i) => (
              <li key={r.userId} className={`co-item${r.isYou ? " co-mine" : ""}`} data-testid="standing" data-veiled={r.veiled ? "1" : undefined}>
                <span className="co-pos">{i + 1}</span>
                <span className="co-name">
                  {shortName(r.name)}
                  <span className="co-rank">{r.tier}</span>
                </span>
                <span className="co-pts">{r.points.toLocaleString()}</span>
                <span className="co-chg">+{r.week.toLocaleString()}</span>
                {moderate && !r.isYou && !r.veiled ? <ModerateMenu target={{ kind: "member", id: r.membershipId, membershipId: r.membershipId, name: shortName(r.name), coach: Boolean(r.coach) }} /> : null}
              </li>
            ))}
            {!rows.length ? <li className="co-quiet">Nobody here yet.</li> : null}
          </ol>
        </section>
      ) : null}
      {tab === "wins" ? (
        <section data-testid="tab-wins-body">
          <div className="co-row-head">
            <h2 className="co-h2">Wins</h2>
            <span className="co-filters">
              <Link href={colosseumHref("wins")} className={!kind ? "co-on" : ""}>All</Link>
              <Link href={colosseumHref("wins", { kind: "business" })} className={kind === "business" ? "co-on" : ""}>Business</Link>
              <Link href={colosseumHref("wins", { kind: "community" })} className={kind === "community" ? "co-on" : ""}>Community</Link>
            </span>
          </div>
          {v.switchedInto ? null : <ShareWin />}
          <WinList wins={wins} tz={v.tz} removable moderate={moderate} applaud={canApplaud} />
        </section>
      ) : null}
      {tab === "challenges" ? (
        <ColosseumChallenges v={v} joined={sp.arena === "in"} />
      ) : null}
      {tab === "week" ? (
        <section data-testid="tab-week-body">
          <div className="co-row-head">
            <h2 className="co-h2">My week</h2>
            <span className="co-quiet">Only you see this</span>
          </div>
          <dl className="co-days">
            {a.week.days.map((d) => (
              <div key={d.day}>
                <dt>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</dt>
                <dd data-testid="week-day">{d.points}</dd>
              </div>
            ))}
          </dl>
          <p className="co-line">
            <b>{a.week.total.toLocaleString()}</b> points this week · {a.week.wins.length} win{a.week.wins.length === 1 ? "" : "s"} shared
          </p>
          <p className="co-line" data-testid="biggest-win">Biggest win: {a.week.biggest ?? "nothing written down yet. Your close-out asks each day."}</p>
        </section>
      ) : null}
    </div>
  );
}
