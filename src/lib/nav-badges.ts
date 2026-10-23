import type { Viewer } from "@/lib/auth";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { agentsOnFor, inboxCount } from "@/lib/handoff";
import { waitingByMenu } from "@/lib/claude-drafts";
import { WHATS_NEW } from "@/content/whats-new";
import { unseenCount } from "@/lib/engine/whats-new";
import { recordingsMenu } from "@/lib/recordings";
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
  // Every count starts at once (Speed 2); only the two that hang on another answer wait for it, so the menu costs two reads in
  // a row at most instead of six.
  const coachView = viewer.role === "coach" && !viewer.switchedInto;
  // A member's own Agent inbox (H-727): in the menu once they have an agent, with the same count; never while switched in or on a team.
  const memberView = viewer.role === "client" && !viewer.switchedInto && !viewer.team;
  // The Recordings item shows a client only once something is published for them (Recordings R1), with the calls they haven't
  // opened yet as its count (rev 498), both from one pass.
  const recordingsQ = viewer.role === "client" ? recordingsMenu(viewer.workspace.id, { userId: viewer.user.id, programTier: viewer.membership.programTier, role: viewer.role }) : Promise.resolve({ enabled: false, fresh: 0 });
  const agentsQ = memberView ? agentsOnFor({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : Promise.resolve(false);
  const [due, recordingsEnabled, reportsNew, feedbackNew, recordingsNew, claimsOpen, verifyWaiting, inboxNew, agentsOn, memberInboxNew, drafts] = await Promise.all([
    intentionsDueFor(viewer.workspace.id, viewer.user.id, viewer.today),
    recordingsQ.then((r) => r.enabled),
    // The coach's counts (rev 432): issues and ideas not yet opened, and monthly feedback new since they last looked.
    coachView ? unseenReports(viewer.workspace.id) : Promise.resolve(0),
    coachView ? newMonthlyFeedback(viewer.workspace.id, viewer.membership.feedbackSeenAt) : Promise.resolve(0),
    recordingsQ.then((r) => (r.enabled ? r.fresh : 0)),
    // Reward claims the coach hasn't marked done and Bot Features waiting to be switched on, on the Coach item.
    coachView ? Promise.all([openClaims(viewer.workspace.id), waitingFeatures(viewer.workspace.id)]).then(([a, b]) => a + b) : Promise.resolve(0),
    // Client work waiting for approval (H-1280): Pathway hand-ins and certification deliverables, on Submissions to verify.
    coachView ? submissionsWaitingCount(viewer.workspace.id) : Promise.resolve(0),
    // The Handoff inbox (rev 769): what waits for the coach's decision and what's new for them, on the Inbox item.
    coachView ? inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : Promise.resolve(0),
    agentsQ,
    agentsQ.then((on) => (on ? inboxCount({ workspaceId: viewer.workspace.id, userId: viewer.user.id }) : 0)),
    // Claude's drafts waiting (H-184): an amber dot on the menu item that holds one. Never a team member's.
    viewer.team ? Promise.resolve({} as Awaited<ReturnType<typeof waitingByMenu>>) : waitingByMenu({ workspaceId: viewer.workspace.id, userId: viewer.user.id }),
  ]);
  return {
    badges: { "/intentions": due.length, "/whats-new": unseenCount(WHATS_NEW, viewer.role, viewer.membership.whatsNewSeen), "/coach/reports": reportsNew, "/coach/feedback": feedbackNew, "/recordings": recordingsNew, "/coach": claimsOpen, [VERIFY_HREF]: verifyWaiting, "/coach/inbox": inboxNew, "/forum/inbox": memberInboxNew, ...Object.fromEntries(Object.entries(drafts).map(([href, n]) => [`draft:${href}`, n])) },
    recordingsEnabled,
    agentsOn,
  };
}
