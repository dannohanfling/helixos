import type { Viewer } from "@/lib/auth";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { agentsOnFor, inboxCount } from "@/lib/handoff";
import { WHATS_NEW } from "@/content/whats-new";
import { unseenCount } from "@/lib/engine/whats-new";
import { hasVisibleRecordings, newRecordings } from "@/lib/recordings";
import { newMonthlyFeedback, unseenReports } from "@/lib/queries/reports";
import { openClaims } from "@/lib/queries/rewards";
import { waitingFeatures } from "@/lib/bot-features";
import { submissionsWaitingCount } from "@/lib/queries/submissions";
import { VERIFY_HREF } from "@/components/nav-groups";
import type { NavBadges } from "@/lib/engine/nav-badges";

export type NavCounts = { badges: NavBadges; recordingsEnabled: boolean; agentsOn: boolean };

/**
 * The menu's counts, worked out once (H-844, plan H-858) for both the sidebar (the app layout) and the phone's More page, so
 * the two can't drift apart. Also whether the Recordings and Agent inbox items show, which the counts depend on.
 */
export async function navBadges(viewer: Viewer): Promise<NavCounts> {
  const [due, recordingsEnabled] = await Promise.all([
    intentionsDueFor(viewer.workspace.id, viewer.user.id, viewer.today),
    // The Recordings item shows a client only once something is published for them (Recordings R1).
    viewer.role === "client" ? hasVisibleRecordings(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }) : Promise.resolve(false),
  ]);
  // The coach's counts (rev 432): issues and ideas not yet opened, and monthly feedback new since they last looked.
  const coachView = viewer.role === "coach" && !viewer.switchedInto;
  const [reportsNew, feedbackNew, recordingsNew, claimsOpen, verifyWaiting] = await Promise.all([
    coachView ? unseenReports(viewer.workspace.id) : Promise.resolve(0),
    coachView ? newMonthlyFeedback(viewer.workspace.id, viewer.membership.feedbackSeenAt) : Promise.resolve(0),
    // Rev 498: the calls this member hasn't opened yet, as a count on the Recordings item.
    recordingsEnabled ? newRecordings(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }).then((r) => r.length) : Promise.resolve(0),
    // Reward claims the coach hasn't marked done and Bot Features waiting to be switched on, on the Coach item.
    coachView ? Promise.all([openClaims(viewer.workspace.id), waitingFeatures(viewer.workspace.id)]).then(([a, b]) => a + b) : Promise.resolve(0),
    // Client work waiting for approval (H-1280): Pathway hand-ins and certification deliverables, on Submissions to verify.
    coachView ? submissionsWaitingCount(viewer.workspace.id) : Promise.resolve(0),
  ]);
  // The Handoff inbox (rev 769): what waits for the coach's decision and what's new for them, on the Inbox item.
  const inboxNew = coachView ? await inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : 0;
  // A member's own Agent inbox (H-727): in the menu once they have an agent, with the same count; never while switched in or on a team.
  const memberView = viewer.role === "client" && !viewer.switchedInto && !viewer.team;
  const agentsOn = memberView ? await agentsOnFor({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : false;
  const memberInboxNew = agentsOn ? await inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : 0;
  return {
    badges: { "/intentions": due.length, "/whats-new": unseenCount(WHATS_NEW, viewer.role, viewer.membership.whatsNewSeen), "/coach/reports": reportsNew, "/coach/feedback": feedbackNew, "/recordings": recordingsNew, "/coach": claimsOpen, [VERIFY_HREF]: verifyWaiting, "/coach/inbox": inboxNew, "/forum/inbox": memberInboxNew },
    recordingsEnabled,
    agentsOn,
  };
}
