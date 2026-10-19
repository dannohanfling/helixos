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
import { rankUpShell } from "@/lib/scenes";
import { oohAccessFor } from "@/lib/office-hours-access";
import { SoundsConfig } from "@/components/sounds-config";
import { VoiceProvider } from "@/components/voice-context";
import { voiceState } from "@/lib/queries/essence";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { agentsOnFor, inboxCount } from "@/lib/handoff";
import { WHATS_NEW } from "@/content/whats-new";
import { unseenCount } from "@/lib/engine/whats-new";
import { chatWidgetProps } from "@/lib/chat";
import { hasVisibleRecordings, newRecordings } from "@/lib/recordings";
import { coachFirstName, newMonthlyFeedback, unseenReports } from "@/lib/queries/reports";
import { openClaims } from "@/lib/queries/rewards";
import { waitingFeatures } from "@/lib/bot-features";
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
  const [points, streak, voice, due, chat, recordingsEnabled, choices] = await Promise.all([
    totalPoints(viewer.workspace.id, viewer.user.id),
    streakFor(viewer.workspace.id, viewer.user.id, { today: viewer.today, hour: viewer.hour, tz: viewer.tz, days: viewer.membership.workDays }),
    voiceState(viewer.workspace.id, viewer.user.id),
    intentionsDueFor(viewer.workspace.id, viewer.user.id, viewer.today),
    chatWidgetProps(viewer),
    // The Recordings item shows a client only once something is published for them (Recordings R1).
    viewer.role === "client" ? hasVisibleRecordings(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }) : Promise.resolve(false),
    // How many HelixOS the signed-in person can be in: more than one shows "Switch HelixOS". Never counted while switched (the coach is in their own session).
    viewer.switchedInto ? Promise.resolve([]) : choicesFor(viewer.actor.id),
  ]);
  // The coach's counts (rev 432): issues and ideas not yet opened, and monthly feedback new since they last looked. A client
  // gets the coach's first name for "Tell Danno" instead.
  const coachView = viewer.role === "coach" && !viewer.switchedInto;
  const [reportsNew, feedbackNew, coachFirst, recordingsNew, claimsOpen] = await Promise.all([
    coachView ? unseenReports(viewer.workspace.id) : Promise.resolve(0),
    coachView ? newMonthlyFeedback(viewer.workspace.id, viewer.membership.feedbackSeenAt) : Promise.resolve(0),
    viewer.role === "client" ? coachFirstName(viewer.workspace.id) : Promise.resolve(null),
    // Rev 498: the calls this member hasn't opened yet, as a count on the Recordings item.
    recordingsEnabled ? newRecordings(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }).then((r) => r.length) : Promise.resolve(0),
    // Reward claims the coach hasn't marked done and Bot Features waiting to be switched on, on the Coach item.
    coachView ? Promise.all([openClaims(viewer.workspace.id), waitingFeatures(viewer.workspace.id)]).then(([a, b]) => a + b) : Promise.resolve(0),
  ]);
  // The Handoff inbox (rev 769): what waits for the coach's decision and what's new for them, on the Inbox item.
  const inboxNew = coachView ? await inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : 0;
  // A member's own Agent inbox (H-727): in the menu once they have an agent, with the same count; never while switched in or on a team.
  const memberView = viewer.role === "client" && !viewer.switchedInto && !viewer.team;
  const agentsOn = memberView ? await agentsOnFor({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : false;
  const memberInboxNew = agentsOn ? await inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : 0;
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
    <AppShell viewer={viewer} chatOn={chat !== null} points={points} flame={flame} flameAfterWelcome={Boolean(welcome || arrival)} recordingsEnabled={recordingsEnabled} loyaltyOn={loyaltyOn} oohOn={oohOn} agentsOn={agentsOn} coachFirst={coachFirst} choices={choices.length} shippedKeys={horizon.shippedKeys} badges={{ "/intentions": due.length, "/whats-new": unseenCount(WHATS_NEW, viewer.role, viewer.membership.whatsNewSeen), "/coach/reports": reportsNew, "/coach/feedback": feedbackNew, "/recordings": recordingsNew, "/coach": claimsOpen, "/coach/inbox": inboxNew, "/forum/inbox": memberInboxNew }}>
      <VoiceProvider ready={voice.ready} filled={voice.filled} total={voice.total}>
        {/* Times in the member's own zone (H-457): the one-time line at the top of the page, once the welcome is out of the way. */}
        {zoneNoticeDue(viewer) && !welcome && !arrival ? <ZoneNotice saved={viewer.membership.timezone} workspaceTz={viewer.workspace.timezone} savedText={viewer.membership.timezone ? zoneNoticeText(viewer.membership.timezone, zoneName(viewer.membership.timezone), false) : null} workspaceText={zoneNoticeText(viewer.workspace.timezone, zoneName(viewer.workspace.timezone), true)} /> : null}
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
