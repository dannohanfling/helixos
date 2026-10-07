import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireViewer } from "@/lib/auth";
import { streakFor } from "@/lib/queries/daily";
import { totalPoints } from "@/lib/queries/points";
import { LevelUp } from "@/components/level-up";
import { TIER_ICONS, tierFor } from "@/lib/engine/tiers";
import { VoiceProvider } from "@/components/voice-context";
import { voiceState } from "@/lib/queries/essence";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { WHATS_NEW } from "@/content/whats-new";
import { unseenCount } from "@/lib/engine/whats-new";
import { chatWidgetProps } from "@/lib/chat";
import { hasVisibleRecordings, newRecordings } from "@/lib/recordings";
import { coachFirstName, newMonthlyFeedback, unseenReports } from "@/lib/queries/reports";
import { choicesFor } from "@/lib/team";

// Every page here is per-user and reads the session cookie. Never prerender it, and never let the build touch the database.
export const dynamic = "force-dynamic";
// Nothing behind the login is for a search engine: a client's dashboard, their numbers, the coach roster.
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The shell draws for a team member too (Danno, 6 Oct); each page decides for itself whether it is open to them.
  const viewer = await requireViewer({ team: "allow" });
  const [points, streak, voice, due, chat, recordingsEnabled, choices] = await Promise.all([
    totalPoints(viewer.workspace.id, viewer.user.id),
    streakFor(viewer.workspace.id, viewer.user.id, viewer.today),
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
  const [reportsNew, feedbackNew, coachFirst, recordingsNew] = await Promise.all([
    coachView ? unseenReports(viewer.workspace.id) : Promise.resolve(0),
    coachView ? newMonthlyFeedback(viewer.workspace.id, viewer.membership.feedbackSeenAt) : Promise.resolve(0),
    viewer.role === "client" ? coachFirstName(viewer.workspace.id) : Promise.resolve(null),
    // Rev 498: the calls this member hasn't opened yet, as a count on the Recordings item.
    recordingsEnabled ? newRecordings(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }).then((r) => r.length) : Promise.resolve(0),
  ]);
  const tier = tierFor(points);
  return (
    <AppShell viewer={viewer} chat={chat} points={points} streak={streak.running} recordingsEnabled={recordingsEnabled} coachFirst={coachFirst} choices={choices.length} badges={{ "/intentions": due.length, "/whats-new": unseenCount(WHATS_NEW, viewer.role, viewer.membership.whatsNewSeen), "/coach/reports": reportsNew, "/coach/feedback": feedbackNew, "/recordings": recordingsNew }}>
      <VoiceProvider ready={voice.ready} filled={voice.filled} total={voice.total}>
        {children}
      </VoiceProvider>
      {viewer.role === "client" && !viewer.team ? <LevelUp tier={{ level: tier.level, name: tier.name, icon: TIER_ICONS[tier.name] ?? "🏅", welcome: tier.welcome }} celebrated={viewer.membership.celebratedTierLevel} /> : null}
    </AppShell>
  );
}
