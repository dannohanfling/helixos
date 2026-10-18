import type { ReactNode } from "react";
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
import { rankUpShell } from "@/lib/scenes";
import { oohAccessFor } from "@/lib/office-hours-access";
import { SoundsConfig } from "@/components/sounds-config";
import { VoiceProvider } from "@/components/voice-context";
import { voiceState } from "@/lib/queries/essence";
import { navBadges } from "@/lib/nav-badges";
import { chatWidgetProps } from "@/lib/chat";
import { coachFirstName } from "@/lib/queries/reports";
import { choicesFor } from "@/lib/team";
import { horizonShell } from "@/lib/horizon";
import { HorizonNotice } from "@/components/horizon-notice";
import { flameStateOf } from "@/lib/engine/streak-flame";

// Every page here is per-user and reads the session cookie. Never prerender it, and never let the build touch the database.
export const dynamic = "force-dynamic";
// Nothing behind the login is for a search engine: a client's dashboard, their numbers, the coach roster.
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The shell draws for a team member too (Danno, 6 Oct); each page decides for itself whether it is open to them.
  const viewer = await requireViewer({ team: "allow" });
  // The menu's counts (H-844): worked out in one place, shared with the phone's More page, so the two show the same numbers.
  const [points, streak, voice, chat, { badges, recordingsEnabled, agentsOn }, choices, coachFirst] = await Promise.all([
    totalPoints(viewer.workspace.id, viewer.user.id),
    streakFor(viewer.workspace.id, viewer.user.id, { today: viewer.today, hour: viewer.hour, tz: viewer.tz, days: viewer.membership.workDays }),
    voiceState(viewer.workspace.id, viewer.user.id),
    chatWidgetProps(viewer),
    navBadges(viewer),
    // How many HelixOS the signed-in person can be in: more than one shows "Switch HelixOS". Never counted while switched (the coach is in their own session).
    viewer.switchedInto ? Promise.resolve([]) : choicesFor(viewer.actor.id),
    // A client gets the coach's first name for "Tell Danno".
    viewer.role === "client" ? coachFirstName(viewer.workspace.id) : Promise.resolve(null),
  ]);
  const rank = rankUpShell(viewer, points);
  // The Loyalty leaderboard menu item (H-140): shown where this membership has a board set up.
  const loyaltyOn = await hasLeaderboardFeed(viewer.membership.id);
  // Office Hours by program level (H-470): the menu item is there only while the account has it.
  const oohOn = (await oohAccessFor(viewer)).open;
  // The Daily welcome (H-312): once a day on first open, over whatever page they opened; never on /coach, never switched in.
  const pathNow = (await headers()).get("x-helixos-path") ?? "";
  // The first arrival (H-472): once per person on their first open, instead of the daily welcome, which starts the next day.
  const arrival = await firstArrivalFor(viewer, pathNow);
  const welcome = arrival ? null : await welcomeFor(viewer, pathNow);
  // On the horizon (H-385): which Coming soon entries have shipped, and the one-time "something you wanted just shipped" notice.
  const horizon = await horizonShell(viewer);
  // The streak flame (H-558): read after the welcome, which counts the first open of the day as showing up. A team member has
  // none (the streak is the owner's); a coach switched in sees the client's flame but never plays their surge.
  const flameStreak = welcome ? await streakFor(viewer.workspace.id, viewer.user.id, { today: viewer.today, hour: viewer.hour, tz: viewer.tz, days: viewer.membership.workDays }) : streak;
  const flame = viewer.team
    ? null
    : flameStateOf({ running: flameStreak.running, asOf: flameStreak.asOf, today: viewer.today, hour: viewer.hour, active: flameStreak.activity.active, closed: flameStreak.closed, seenOn: viewer.switchedInto ? flameStreak.asOf : viewer.membership.streakSurgeSeenOn });
  return (
    <AppShell viewer={viewer} chatOn={chat !== null} points={points} flame={flame} flameAfterWelcome={Boolean(welcome || arrival)} recordingsEnabled={recordingsEnabled} loyaltyOn={loyaltyOn} oohOn={oohOn} agentsOn={agentsOn} coachFirst={coachFirst} choices={choices.length} shippedKeys={horizon.shippedKeys} badges={badges}>
      <VoiceProvider ready={voice.ready} filled={voice.filled} total={voice.total}>
        {children}
      </VoiceProvider>
      <SoundsConfig on={viewer.membership.soundsOn} />
      {arrival ? <FirstArrival card={arrival} /> : null}
      {welcome ? <DailyWelcome card={welcome} /> : null}
      {horizon.notice && !welcome ? <HorizonNotice notice={horizon.notice} /> : null}
      {/* The rank-up ceremony (H-327 §1): once per rank, after the welcome when both are due; never on /coach, never switched in. */}
      {rank ? <RankUp {...(rank.stampOnly ? rank : { ...rank, afterWelcome: Boolean(welcome) })} /> : null}
    </AppShell>
  );
}
