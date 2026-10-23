import type { ReactNode } from "react";
import { ZoneNotice } from "@/components/zone-notice";
import { zoneNoticeDue, zoneNoticeText } from "@/lib/engine/zones";
import { zoneName } from "@/lib/dates";
import { AppShell } from "@/components/app-shell";
import { hasLeaderboardFeed } from "@/lib/leaderboard";
import { requireViewer } from "@/lib/auth";
import { streakFor } from "@/lib/queries/daily";
import { headers } from "next/headers";
import { welcomeFor } from "@/lib/welcome";
import { firstArrivalFor } from "@/lib/first-arrival";
import { FirstArrival } from "@/components/first-arrival";
import { DailyWelcome } from "@/components/daily-welcome";
import { totalPoints } from "@/lib/queries/points";
import { RankUp } from "@/components/rank-up";
import { catchUpShell, rankUpShell } from "@/lib/scenes";
import { keepRank } from "@/lib/ranks";
import { oohAccessFor } from "@/lib/office-hours-access";
import { SoundsConfig } from "@/components/sounds-config";
import { SceneMotionConfig } from "@/components/scene-motion-config";
import { VoiceProvider } from "@/components/voice-context";
import { voiceState } from "@/lib/queries/essence";
import { navBadges } from "@/lib/nav-badges";
import { chatWidgetProps } from "@/lib/chat";
import { coachFirstName } from "@/lib/queries/reports";
import { choiceCount } from "@/lib/team";
import { horizonShell } from "@/lib/horizon";
import { HorizonNotice } from "@/components/horizon-notice";
import { flameStateOf } from "@/lib/engine/streak-flame";
import { appLinks, appLinksOn } from "@/lib/app-links";
import { hasAppFor } from "@/lib/queries/app-devices";

// Every page here is per-user and reads the session cookie. Never prerender it, and never let the build touch the database.
export const dynamic = "force-dynamic";
// Nothing behind the login is for a search engine: a client's dashboard, their numbers, the coach roster.
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The shell draws for a team member too (Danno, 6 Oct); each page decides for itself whether it is open to them.
  const viewer = await requireViewer({ team: "allow" });
  // The whole frame in one wait (Speed 2, H-1623): everything below is read together, and only the kept rank waits for the
  // points it climbs with. The menu's counts (H-844) are worked out in one place, shared with the phone's More page.
  const pointsQ = totalPoints(viewer.workspace.id, viewer.user.id);
  const [points, streak, voice, chat, { badges, recordingsEnabled, agentsOn }, choices, coachFirst, loyaltyOn, ooh, hasAppRow, hdrs, horizon] = await Promise.all([
    // The kept rank climbs with the points (H-1088), before anything below reads the member's rank.
    pointsQ.then(async (p) => {
      await keepRank(viewer, p);
      return p;
    }),
    streakFor(viewer.workspace.id, viewer.user.id, { today: viewer.today, hour: viewer.hour, tz: viewer.tz, days: viewer.membership.workDays }),
    voiceState(viewer.workspace.id, viewer.user.id),
    chatWidgetProps(viewer),
    navBadges(viewer),
    // How many HelixOS the signed-in person can be in: more than one shows "Switch HelixOS". Never counted while switched (the coach is in their own session).
    viewer.switchedInto ? Promise.resolve(0) : choiceCount(viewer.actor.id),
    // A client gets the coach's first name for "Tell Danno".
    viewer.role === "client" ? coachFirstName(viewer.workspace.id) : Promise.resolve(null),
    // The Loyalty leaderboard menu item (H-140): shown where this membership has a board set up.
    hasLeaderboardFeed(viewer.membership.id),
    // Office Hours by program level (H-470): the menu item is there only while the account has it.
    oohAccessFor(viewer),
    // Get the app (H-655): Coming soon until a store link is set; gone once one of this member's phones opened the app. Not for a team member.
    viewer.team ? Promise.resolve(null) : hasAppFor(viewer.membership.id),
    headers(),
    // On the horizon (H-385): which Coming soon entries have shipped, and the one-time "something you wanted just shipped" notice.
    horizonShell(viewer),
  ]);
  const rank = rankUpShell(viewer, points);
  const oohOn = ooh.open;
  const hasApp = Boolean(hasAppRow);
  // The Daily welcome (H-312): once a day on first open, over whatever page they opened; never on /coach, never switched in.
  const pathNow = hdrs.get("x-helixos-path") ?? "";
  // The first arrival (H-472): once per person on their first open, instead of the daily welcome, which starts the next day.
  const arrival = await firstArrivalFor(viewer, pathNow);
  const welcome = arrival ? null : await welcomeFor(viewer, pathNow);
  // The catch-up ceremony (H-934): a rank reached before the relic clips gets its clip once, first thing, when no rank-up is due.
  const catchUp = (rank && !rank.stampOnly) || arrival ? null : await catchUpShell(viewer, points, rank?.stampOnly === true);
  const catchUpPlays = catchUp?.kind === "play";
  // The streak flame (H-558): read after the welcome, which counts the first open of the day as showing up. A team member has
  // none (the streak is the owner's); a coach switched in sees the client's flame but never plays their surge.
  const flameStreak = welcome ? await streakFor(viewer.workspace.id, viewer.user.id, { today: viewer.today, hour: viewer.hour, tz: viewer.tz, days: viewer.membership.workDays }) : streak;
  const flame = viewer.team
    ? null
    : flameStateOf({ running: flameStreak.running, asOf: flameStreak.asOf, today: viewer.today, hour: viewer.hour, active: flameStreak.activity.active, closed: flameStreak.closed, seenOn: viewer.switchedInto ? flameStreak.asOf : viewer.membership.streakSurgeSeenOn });
  return (
    <AppShell viewer={viewer} chatOn={chat !== null} points={points} flame={flame} flameAfterWelcome={Boolean(welcome || arrival || catchUpPlays)} recordingsEnabled={recordingsEnabled} loyaltyOn={loyaltyOn} oohOn={oohOn} agentsOn={agentsOn} coachFirst={coachFirst} appLinks={appLinksOn(appLinks())} hasApp={hasApp} choices={choices} shippedKeys={horizon.shippedKeys} badges={badges}>
      <VoiceProvider ready={voice.ready} filled={voice.filled} total={voice.total}>
        {/* Times in the member's own zone (H-457): the one-time line at the top of the page, once the welcome is out of the way. */}
        {zoneNoticeDue(viewer) && !welcome && !arrival ? <ZoneNotice saved={viewer.membership.timezone} workspaceTz={viewer.workspace.timezone} savedText={viewer.membership.timezone ? zoneNoticeText(viewer.membership.timezone, zoneName(viewer.membership.timezone), false) : null} workspaceText={zoneNoticeText(viewer.workspace.timezone, zoneName(viewer.workspace.timezone), true)} /> : null}
        {children}
      </VoiceProvider>
      {/* A tab left open across a deploy moves to the new build on its next click (Speed 2). */}
      <SoundsConfig on={viewer.membership.soundsOn} />
      <SceneMotionConfig on={viewer.membership.sceneMotion} />
      {arrival ? <FirstArrival card={arrival} /> : null}
      {welcome ? <DailyWelcome card={welcome} afterRank={catchUpPlays} /> : null}
      {horizon.notice && !welcome && !catchUpPlays ? <HorizonNotice notice={horizon.notice} /> : null}
      {/* The rank-up ceremony (H-327 §1): once per rank, after the welcome when both are due; never on /coach, never switched in. */}
      {rank ? <RankUp {...(rank.stampOnly ? rank : { ...rank, afterWelcome: Boolean(welcome) })} /> : null}
      {catchUp?.kind === "play" ? <RankUp stampOnly={false} card={catchUp.card} clip={catchUp.clip} afterWelcome={false} catchUp={welcome ? "first" : "alone"} /> : null}
      {catchUp?.kind === "stamp" ? <RankUp stampOnly level={catchUp.level} clipOnly /> : null}
    </AppShell>
  );
}
